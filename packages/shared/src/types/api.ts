/**
 * API request/response DTOs shared between backend and frontend.
 */
import type { DomainRecord } from './domain.js';
import type { HistoryPoint, Incident, RunSummary } from './check.js';
import type { Distributions, KpiSnapshot } from './report.js';

/** Standard error envelope (RFC 7807 inspired). */
export interface ApiError {
  status: number;
  title: string;
  detail: string;
  errors?: Record<string, string[]>;
}

/** Login request. */
export interface LoginRequest {
  email: string;
  password: string;
}

/** Login response. */
export interface LoginResponse {
  token: string;
  expiresIn: string;
  user: { email: string; role: 'admin' };
}

/** Paginated list envelope. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Query params for GET /domains. */
export interface DomainListQuery {
  q?: string;
  status?: string;
  category?: string;
  tag?: string;
  company?: string;
  project?: string;
  owner?: string;
  sortBy?: keyof DomainRecord;
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/** Create-domain payload (user-owned fields only; monitor fills the rest). */
export interface CreateDomainRequest {
  website: string;
  company?: string;
  project?: string;
  owner?: string;
  department?: string;
  notes?: string;
  tags?: string;
  category?: string;
}

/** Patch-domain payload. */
export type UpdateDomainRequest = Partial<CreateDomainRequest>;

/** Bulk operation on domains. */
export interface BulkDomainRequest {
  action: 'delete' | 'tag' | 'untag' | 'categorize' | 'pause' | 'resume';
  domains: string[];
  /** Tag or category value for tag/categorize actions. */
  value?: string;
}

/** Import: parsed & validated row preview. */
export interface ImportRowPreview {
  row: number;
  website: string;
  domain: string;
  company: string;
  project: string;
  owner: string;
  department: string;
  tags: string;
  category: string;
  valid: boolean;
  duplicate: boolean;
  corrected: boolean;
  reason: string;
}

/** Import commit result. */
export interface ImportReport {
  importId: string;
  totalImported: number;
  duplicatesRemoved: number;
  invalid: number;
  corrected: number;
  skipped: number;
  accepted: number;
  rejectedRows: ImportRowPreview[];
  importedAt: string;
}

/** Trigger a monitoring run. */
export interface TriggerJobRequest {
  /** Limit to specific domains (comma-joined for workflow input). */
  domains?: string[];
  limit?: number;
  skipScreenshots?: boolean;
}

/** GitHub Actions run info surfaced to the dashboard. */
export interface JobRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  event: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  durationSeconds: number | null;
}

/** GET /monitoring/status payload. */
export interface MonitoringStatus {
  lastRun: RunSummary | null;
  dataSource: 'sheets' | 'cache';
  cacheGeneratedAt: string | null;
}

/** GET /analytics/kpis payload. */
export type AnalyticsKpisResponse = KpiSnapshot;

/** GET /analytics/trends payload. */
export interface AnalyticsTrendsResponse {
  points: HistoryPoint[];
}

/** GET /analytics/distributions payload. */
export type AnalyticsDistributionsResponse = Distributions;

/** GET /monitoring/incidents payload. */
export interface IncidentsResponse {
  incidents: Incident[];
}

/** Audit log entry. */
export interface AuditEntry {
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  ip: string;
  userAgent: string;
  status: 'success' | 'failure';
  before: string;
  after: string;
  reason: string;
}

/** Health check response. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  version: string;
  sheets: { reachable: boolean; cacheAgeSeconds: number | null };
  timestamp: string;
}

/** Settings stored in the Settings sheet tab. */
export interface AppSettings {
  sslWarnDays: number;
  responseTimeWarnMs: number;
  savedFilters: SavedFilter[];
}

/** A saved filter preset for the domains table. */
export interface SavedFilter {
  name: string;
  query: DomainListQuery;
}
