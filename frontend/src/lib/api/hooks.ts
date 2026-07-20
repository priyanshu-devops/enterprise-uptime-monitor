'use client';

/**
 * React Query hooks over the API client. Query keys are grouped per resource
 * so mutations can invalidate precisely.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import type {
  AppSettings,
  AuditEntry,
  BulkDomainRequest,
  CreateDomainRequest,
  Distributions,
  DomainRecord,
  HealthResponse,
  HistoryPoint,
  ImportReport,
  ImportRowPreview,
  Incident,
  JobRun,
  KpiSnapshot,
  LoginRequest,
  LoginResponse,
  MonitoringStatus,
  Paginated,
  SlaReport,
  TriggerJobRequest,
  UpdateDomainRequest,
} from '@uptime/shared';
import { apiDownload, apiGet, apiGetLive, apiMutate, fetchHealthz, type ApiResult } from './client';

export const queryKeys = {
  domains: ['domains'] as const,
  domain: (d: string) => ['domains', d] as const,
  kpis: ['analytics', 'kpis'] as const,
  trends: (days: number) => ['analytics', 'trends', days] as const,
  distributions: ['analytics', 'distributions'] as const,
  incidents: ['incidents'] as const,
  monitoringStatus: ['monitoring', 'status'] as const,
  jobs: ['jobs'] as const,
  audit: (page: number) => ['audit', page] as const,
  logs: (category: string, date: string) => ['logs', category, date] as const,
  settings: ['settings'] as const,
  sla: ['analytics', 'sla'] as const,
  health: ['health'] as const,
  reports: ['reports'] as const,
  importHistory: ['import', 'history'] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Full domain list (pageSize=1000); table filters/paginates client-side. */
export function useDomains() {
  return useQuery({
    queryKey: queryKeys.domains,
    queryFn: () => apiGet<Paginated<DomainRecord>>('/domains?page=1&pageSize=1000'),
    staleTime: 30000,
  });
}

export function useDomain(domain: string) {
  return useQuery({
    queryKey: queryKeys.domain(domain),
    queryFn: () => apiGet<DomainRecord>(`/domains/${encodeURIComponent(domain)}`),
    enabled: Boolean(domain),
  });
}

export function useKpis() {
  return useQuery({
    queryKey: queryKeys.kpis,
    queryFn: () => apiGet<KpiSnapshot>('/analytics/kpis'),
    staleTime: 30000,
  });
}

export function useTrends(days = 30) {
  return useQuery({
    queryKey: queryKeys.trends(days),
    queryFn: () => apiGet<{ points: HistoryPoint[] }>(`/analytics/trends?days=${days}`),
    staleTime: 60000,
  });
}

export function useDistributions() {
  return useQuery({
    queryKey: queryKeys.distributions,
    queryFn: () => apiGet<Distributions>('/analytics/distributions'),
    staleTime: 60000,
  });
}

export function useIncidents() {
  return useQuery({
    queryKey: queryKeys.incidents,
    queryFn: () => apiGet<{ incidents: Incident[] }>('/monitoring/incidents'),
    staleTime: 30000,
  });
}

/** SLA report (uptime windows + percentiles); null until the first run writes it. */
export function useSla() {
  return useQuery({
    queryKey: queryKeys.sla,
    queryFn: () => apiGet<SlaReport | null>('/analytics/sla'),
    staleTime: 60000,
  });
}

export function useMonitoringStatus() {
  return useQuery({
    queryKey: queryKeys.monitoringStatus,
    queryFn: () => apiGet<MonitoringStatus>('/monitoring/status'),
    staleTime: 30000,
  });
}

/** Job runs; polls while any run is queued/in progress. */
export function useJobs() {
  return useQuery({
    queryKey: queryKeys.jobs,
    queryFn: () => apiGetLive<JobRun[]>('/jobs', 15000),
    refetchInterval: (query) => {
      const jobs = query.state.data;
      return jobs?.some((j) => j.status === 'in_progress' || j.status === 'queued') ? 10000 : false;
    },
  });
}

export function useAudit(page = 1, pageSize = 50) {
  return useQuery({
    queryKey: queryKeys.audit(page),
    queryFn: () =>
      apiGetLive<Paginated<AuditEntry>>(`/audit?page=${page}&pageSize=${pageSize}`, 15000),
  });
}

/** Log rows — shape is loose (monitor vs audit categories differ). */
export interface LogRow {
  timestamp?: string;
  time?: string;
  level?: string;
  domain?: string;
  actor?: string;
  message?: string;
  action?: string;
  [key: string]: unknown;
}

export function useLogs(category: 'monitor' | 'audit', date: string) {
  return useQuery({
    queryKey: queryKeys.logs(category, date),
    queryFn: () => apiGetLive<LogRow[]>(`/logs?category=${category}&date=${date}`, 15000),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => apiGetLive<AppSettings>('/settings', 15000),
  });
}

/** Health poll used by the settings page connection card. */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => fetchHealthz(),
    retry: false,
    refetchInterval: 30000,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

type MutOpts<TData, TVars> = Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'>;

export function useLogin(options?: MutOpts<LoginResponse, LoginRequest>) {
  return useMutation({
    mutationFn: (body: LoginRequest) => apiMutate<LoginResponse>('POST', '/auth/login', body),
    ...options,
  });
}

export function useCreateDomain(options?: MutOpts<DomainRecord, CreateDomainRequest>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDomainRequest) => apiMutate<DomainRecord>('POST', '/domains', body),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.domains }),
    ...options,
  });
}

export function useUpdateDomain(
  options?: MutOpts<DomainRecord, { domain: string; patch: UpdateDomainRequest }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ domain, patch }: { domain: string; patch: UpdateDomainRequest }) =>
      apiMutate<DomainRecord>('PATCH', `/domains/${encodeURIComponent(domain)}`, patch),
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.domains });
      qc.invalidateQueries({ queryKey: queryKeys.domain(vars.domain) });
    },
    ...options,
  });
}

export function useDeleteDomain(options?: MutOpts<unknown, string>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domain: string) =>
      apiMutate<unknown>('DELETE', `/domains/${encodeURIComponent(domain)}`),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.domains }),
    ...options,
  });
}

export function useBulkDomains(options?: MutOpts<unknown, BulkDomainRequest>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkDomainRequest) => apiMutate<unknown>('POST', '/domains/bulk', body),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.domains }),
    ...options,
  });
}

/** Acknowledge or manually resolve an incident. */
export function useIncidentAction(
  options?: MutOpts<Incident, { id: string; action: 'ack' | 'resolve' }>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'ack' | 'resolve' }) =>
      apiMutate<Incident>('PATCH', `/monitoring/incidents/${encodeURIComponent(id)}`, { action }),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.incidents }),
    ...options,
  });
}

export function useTriggerJob(options?: MutOpts<unknown, TriggerJobRequest>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TriggerJobRequest) => apiMutate<unknown>('POST', '/jobs/trigger', body),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.jobs }),
    ...options,
  });
}

export interface ImportBody {
  source: 'csv' | 'xlsx' | 'txt' | 'paste' | 'manual' | 'sheet';
  rows: {
    website: string;
    company?: string;
    project?: string;
    owner?: string;
    department?: string;
    tags?: string;
    category?: string;
  }[];
}

export function useImportPreview(options?: MutOpts<ImportRowPreview[], ImportBody>) {
  return useMutation({
    mutationFn: (body: ImportBody) => apiMutate<ImportRowPreview[]>('POST', '/import/preview', body),
    ...options,
  });
}

export function useImportCommit(options?: MutOpts<ImportReport, ImportBody>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportBody) => apiMutate<ImportReport>('POST', '/import/commit', body),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.domains });
      qc.invalidateQueries({ queryKey: queryKeys.kpis });
    },
    ...options,
  });
}

export function useUpdateSettings(options?: MutOpts<AppSettings, AppSettings>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AppSettings) => apiMutate<AppSettings>('PUT', '/settings', body),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.settings }),
    ...options,
  });
}

export function useResyncSheets(options?: MutOpts<unknown, void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiMutate<unknown>('POST', '/sheets/resync'),
    onSettled: () => qc.invalidateQueries(),
    ...options,
  });
}

export function useGenerateReport(options?: MutOpts<unknown, { period: string }>) {
  return useMutation({
    mutationFn: (body: { period: string }) => apiMutate<unknown>('POST', '/reports/generate', body),
    ...options,
  });
}

/** Kick off a binary report download; resolves when the blob is saved. */
export function useExportReport(
  options?: MutOpts<void, { format: string; period: string; from?: string; to?: string }>,
) {
  return useMutation({
    mutationFn: async (vars: { format: string; period: string; from?: string; to?: string }) => {
      const params = new URLSearchParams({ format: vars.format, period: vars.period });
      if (vars.from) params.set('from', vars.from);
      if (vars.to) params.set('to', vars.to);
      await apiDownload(
        `/reports/export?${params.toString()}`,
        `uptime-report-${vars.period}.${vars.format}`,
      );
    },
    ...options,
  });
}

export type { ApiResult };
