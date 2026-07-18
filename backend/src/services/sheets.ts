/**
 * Sheets service — wraps the gsheets repositories with caching.
 * Provides a clean API for the route handlers.
 */
import pino from 'pino';
import { SheetsClient, DomainsRepository, AuditLogRepository, IncidentLogRepository, ImportHistoryRepository, SettingsRepository } from '@uptime/gsheets';
import type { RowRecord } from '@uptime/gsheets';
import type { DomainRecord, AppSettings, AuditEntry, Incident, ImportReport, ImportRowPreview } from '@uptime/shared';
import { normalizeDomain, emptyDomainRecord } from '@uptime/shared';

import { CacheService } from './cache.js';

const logger = pino({ name: 'sheets-service' });

export interface SheetsServiceConfig {
  spreadsheetId: string;
  serviceAccountJsonB64: string;
  cacheService: CacheService;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DomainQuery {
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

export class SheetsService {
  private client: SheetsClient;
  private domainsRepo: DomainsRepository;
  private auditRepo: AuditLogRepository;
  private incidentRepo: IncidentLogRepository;
  private importRepo: ImportHistoryRepository;
  private settingsRepo: SettingsRepository;
  private cache: CacheService;
  private domainsCache: RowRecord[] | null = null;
  private domainsCacheAt: number = 0;

  constructor(config: SheetsServiceConfig) {
    this.client = new SheetsClient({
      spreadsheetId: config.spreadsheetId,
      serviceAccountJsonB64: config.serviceAccountJsonB64,
    });
    this.domainsRepo = new DomainsRepository(this.client);
    this.auditRepo = new AuditLogRepository(this.client);
    this.incidentRepo = new IncidentLogRepository(this.client);
    this.importRepo = new ImportHistoryRepository(this.client);
    this.settingsRepo = new SettingsRepository(this.client);
    this.cache = config.cacheService;
  }

  /** Get the underlying SheetsClient for advanced operations. */
  getClient(): SheetsClient {
    return this.client;
  }

  /** Get the internal CacheService (exposed for Express middleware). */
  getCacheService(): CacheService {
    return this.cache;
  }

  /** Flush all cache state and stop cleanup timers (graceful shutdown). */
  async flush(): Promise<void> {
    await this.cache.flush();
  }

  /** Read all domains from sheet (with 5-min cache). */
  async readAllDomains(forceRefresh = false): Promise<RowRecord[]> {
    const cacheKey = 'domains:all';
    const ttlSeconds = Number(process.env.CACHE_TTL_SECONDS) || 300;

    if (!forceRefresh) {
      const cached = this.cache.get<RowRecord[]>(cacheKey);
      if (cached) {
        logger.debug({ age: Date.now() - cached.timestamp }, 'Domains cache hit');
        return cached.data;
      }
    }

    logger.info('Reading domains from sheet...');
    const domains = await this.domainsRepo.readAll();
    this.cache.set(cacheKey, domains, ttlSeconds);
    return domains;
  }

  /** Get domains with filtering, sorting, and pagination. */
  async getDomains(query: DomainQuery = {}): Promise<PaginatedResult<RowRecord>> {
    const domains = await this.readAllDomains();
    let filtered = domains;

    // Text search across multiple fields
    if (query.q) {
      const search = query.q.toLowerCase();
      filtered = filtered.filter((r) =>
        r.record.domain.toLowerCase().includes(search) ||
        r.record.website.toLowerCase().includes(search) ||
        r.record.company.toLowerCase().includes(search) ||
        r.record.project.toLowerCase().includes(search) ||
        r.record.owner.toLowerCase().includes(search) ||
        r.record.tags.toLowerCase().includes(search) ||
        r.record.category.toLowerCase().includes(search)
      );
    }

    // Exact field filters
    if (query.status) {
      filtered = filtered.filter((r) => r.record.status === query.status);
    }
    if (query.category) {
      filtered = filtered.filter((r) => r.record.category === query.category);
    }
    if (query.tag) {
      filtered = filtered.filter((r) => r.record.tags.split(',').map((t: string) => t.trim()).includes(query.tag!));
    }
    if (query.company) {
      filtered = filtered.filter((r) => r.record.company === query.company);
    }
    if (query.project) {
      filtered = filtered.filter((r) => r.record.project === query.project);
    }
    if (query.owner) {
      filtered = filtered.filter((r) => r.record.owner === query.owner);
    }

    // Sorting
    const sortBy = query.sortBy || 'domain';
    const sortDir = query.sortDir || 'asc';
    filtered.sort((a, b) => {
      const aVal = a.record[sortBy];
      const bVal = b.record[sortBy];
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    // Pagination
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 50));
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return {
      items,
      total: filtered.length,
      page,
      pageSize,
    };
  }

  /** Get a single domain by normalized domain name. */
  async getDomain(domain: string): Promise<RowRecord | null> {
    const domains = await this.readAllDomains();
    return domains.find((r) => r.record.domain === domain) || null;
  }

  /** Create a new domain record. */
  async createDomain(data: Partial<DomainRecord>, actor: string, ip: string, userAgent: string): Promise<RowRecord> {
    const normalized = normalizeDomain(data.website || '');
    if (normalized.invalid) {
      throw new Error(`Invalid website: ${normalized.reason}`);
    }

    // Check for duplicate
    const existing = await this.getDomain(normalized.domain);
    if (existing) {
      throw new Error(`Domain already exists: ${normalized.domain}`);
    }

    const record = emptyDomainRecord();
    record.company = data.company || '';
    record.project = data.project || '';
    record.owner = data.owner || '';
    record.department = data.department || '';
    record.website = normalized.website;
    record.domain = normalized.domain;
    record.status = 'PENDING';
    record.tags = data.tags || '';
    record.category = data.category || '';
    record.notes = data.notes || '';

    await this.domainsRepo.appendRecords([record]);
    await this.auditRepo.record({
      timestamp: new Date().toISOString(),
      actor,
      action: 'CREATE',
      target: record.domain,
      ip,
      userAgent,
      status: 'success',
      before: '',
      after: JSON.stringify(record),
      reason: 'Domain created via API',
    });

    // Invalidate cache
    this.cache.invalidatePrefix('domains:');

    return { rowNumber: 0, record }; // rowNumber unknown after append
  }

  /** Update a domain (user-owned fields only). */
  async updateDomain(
    domain: string,
    data: Partial<DomainRecord>,
    actor: string,
    ip: string,
    userAgent: string,
  ): Promise<RowRecord> {
    const existing = await this.getDomain(domain);
    if (!existing) {
      throw new Error(`Domain not found: ${domain}`);
    }

    const before = { ...existing.record };
    const allowedFields = ['company', 'project', 'owner', 'department', 'website', 'notes', 'tags', 'category'] as const;

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        // Special handling for website (renormalize)
        if (field === 'website' && data.website) {
          const normalized = normalizeDomain(data.website);
          if (normalized.invalid) {
            throw new Error(`Invalid website: ${normalized.reason}`);
          }
          // Check if new domain conflicts
          if (normalized.domain !== domain) {
            const conflict = await this.getDomain(normalized.domain);
            if (conflict) throw new Error(`Domain already exists: ${normalized.domain}`);
            existing.record.domain = normalized.domain;
            existing.record.website = normalized.website;
          }
        } else {
          (existing.record as unknown as Record<string, string>)[field] = data[field] as string;
        }
      }
    }

    await this.domainsRepo.updateFields(domain, existing.record);
    await this.auditRepo.record({
      timestamp: new Date().toISOString(),
      actor,
      action: 'UPDATE',
      target: domain,
      ip,
      userAgent,
      status: 'success',
      before: JSON.stringify(before),
      after: JSON.stringify(existing.record),
      reason: 'Domain updated via API',
    });

    this.cache.invalidatePrefix('domains:');
    return existing;
  }

  /** Delete domains. */
  async deleteDomains(
    domains: string[],
    actor: string,
    ip: string,
    userAgent: string,
  ): Promise<number> {
    const deleted = await this.domainsRepo.deleteDomains(domains);
    for (const domain of domains) {
      await this.auditRepo.record({
        timestamp: new Date().toISOString(),
        actor,
        action: 'DELETE',
        target: domain,
        ip,
        userAgent,
        status: 'success',
        before: '',
        after: '',
        reason: 'Domain deleted via API',
      });
    }
    this.cache.invalidatePrefix('domains:');
    return deleted;
  }

  /** Bulk operations on domains. */
  async bulkDomains(
    action: 'tag' | 'untag' | 'categorize' | 'pause' | 'resume',
    domains: string[],
    value?: string,
    actor: string = 'api',
    ip: string = '',
    userAgent: string = '',
  ): Promise<number> {
    const allDomains = await this.readAllDomains();
    let updated = 0;

    for (const domain of domains) {
      const row = allDomains.find((r) => r.record.domain === domain);
      if (!row) continue;

      const before = { ...row.record };
      switch (action) {
        case 'tag':
          if (value) {
            const tags = row.record.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
            if (!tags.includes(value)) tags.push(value);
            row.record.tags = tags.join(', ');
          }
          break;
        case 'untag':
          if (value) {
            const tags = row.record.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t !== value);
            row.record.tags = tags.join(', ');
          }
          break;
        case 'categorize':
          if (value) row.record.category = value;
          break;
        case 'pause':
          row.record.status = 'PAUSED';
          break;
        case 'resume':
          row.record.status = 'PENDING';
          break;
      }

      await this.domainsRepo.updateFields(domain, row.record);
      await this.auditRepo.record({
        timestamp: new Date().toISOString(),
        actor,
        action: action.toUpperCase(),
        target: domain,
        ip,
        userAgent,
        status: 'success',
        before: JSON.stringify(before),
        after: JSON.stringify(row.record),
        reason: `Bulk ${action} via API`,
      });
      updated++;
    }

    this.cache.invalidatePrefix('domains:');
    return updated;
  }

  /** Import domains from CSV/JSON. */
  async importDomains(
    rows: ImportRowPreview[],
    actor: string,
    ip: string,
    userAgent: string,
    source: string,
  ): Promise<ImportReport> {
    const existing = await this.readAllDomains();
    const known = new Set(existing.map((r) => r.record.domain));

    const toImport: DomainRecord[] = [];
    const rejected: ImportRowPreview[] = [];
    let duplicates = 0;
    let invalid = 0;
    let corrected = 0;

    for (const row of rows) {
      if (!row.valid || row.duplicate) {
        rejected.push(row);
        if (row.duplicate) duplicates++;
        if (!row.valid) invalid++;
        continue;
      }

      if (row.corrected) corrected++;

      const record = emptyDomainRecord();
      record.company = row.company;
      record.project = row.project;
      record.owner = row.owner;
      record.department = row.department;
      record.website = row.website;
      record.domain = row.domain;
      record.status = 'PENDING';
      record.tags = row.tags;
      record.category = row.category;

      toImport.push(record);
    }

    if (toImport.length > 0) {
      await this.domainsRepo.appendRecords(toImport);
    }

    const report: ImportReport = {
      importId: crypto.randomUUID(),
      totalImported: rows.length,
      duplicatesRemoved: duplicates,
      invalid,
      corrected,
      skipped: rejected.length,
      accepted: toImport.length,
      rejectedRows: rejected,
      importedAt: new Date().toISOString(),
    };

    await this.importRepo.append({
      importId: report.importId,
      importedAt: report.importedAt,
      actor,
      source,
      total: rows.length,
      accepted: toImport.length,
      duplicates,
      invalid,
      corrected,
      skipped: rejected.length,
    });

    await this.auditRepo.record({
      timestamp: new Date().toISOString(),
      actor,
      action: 'IMPORT',
      target: `${toImport.length} domains`,
      ip,
      userAgent,
      status: 'success',
      before: '',
      after: JSON.stringify({ accepted: toImport.length, rejected: rejected.length }),
      reason: `Import from ${source}`,
    });

    this.cache.invalidatePrefix('domains:');
    return report;
  }

  /** Get analytics KPIs. */
  async getKpis(): Promise<{
    totalDomains: number;
    healthy: number;
    down: number;
    degraded: number;
    paused: number;
    sslExpiringSoon: number;
    sslExpired: number;
    redirectIssues: number;
    dnsIssues: number;
    avgResponseTimeMs: number;
    avgTtfbMs: number;
    avgHealthScore: number;
    avgRiskScore: number;
    cloudflareCount: number;
    wordpressCount: number;
    httpsCount: number;
    generatedAt: string;
  }> {
    const domains = await this.readAllDomains();

    const total = domains.length;
    let healthy = 0, down = 0, degraded = 0, paused = 0;
    let sslExpiringSoon = 0, sslExpired = 0;
    let redirectIssues = 0, dnsIssues = 0;
    let totalResponseTime = 0, totalTtfb = 0;
    let totalHealth = 0, totalRisk = 0;
    let cloudflareCount = 0, wordpressCount = 0, httpsCount = 0;

    for (const row of domains) {
      const r = row.record;
      switch (r.status) {
        case 'UP': healthy++; break;
        case 'DOWN': down++; break;
        case 'DEGRADED': degraded++; break;
        case 'PAUSED': paused++; break;
      }

      if (r.redirectUrl) redirectIssues++;
      if (r.dns && !r.dns.includes('A') && !r.dns.includes('AAAA')) dnsIssues++;

      const sslDays = parseInt(r.sslDaysRemaining, 10);
      if (!isNaN(sslDays)) {
        if (sslDays < 0) sslExpired++;
        else if (sslDays <= 30) sslExpiringSoon++;
      }

      const rt = parseInt(r.responseTime, 10);
      if (!isNaN(rt)) totalResponseTime += rt;

      const ttfb = parseInt(r.ttfb, 10);
      if (!isNaN(ttfb)) totalTtfb += ttfb;

      const hs = parseInt(r.healthScore, 10);
      if (!isNaN(hs)) totalHealth += hs;

      const rs = parseInt(r.riskScore, 10);
      if (!isNaN(rs)) totalRisk += rs;

      if (r.cloudflare === 'Yes') cloudflareCount++;
      if (r.wordpress === 'Yes') wordpressCount++;
      if (r.https === 'Yes') httpsCount++;
    }

    const avgResponseTimeMs = total > 0 ? Math.round(totalResponseTime / total) : 0;
    const avgTtfbMs = total > 0 ? Math.round(totalTtfb / total) : 0;
    const avgHealthScore = total > 0 ? Math.round(totalHealth / total) : 0;
    const avgRiskScore = total > 0 ? Math.round(totalRisk / total) : 0;

    return {
      totalDomains: total,
      healthy,
      down,
      degraded,
      paused,
      sslExpiringSoon,
      sslExpired,
      redirectIssues,
      dnsIssues,
      avgResponseTimeMs,
      avgTtfbMs,
      avgHealthScore,
      avgRiskScore,
      cloudflareCount,
      wordpressCount,
      httpsCount,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Get trends history from cache/summary.json. */
  async getTrends(): Promise<Array<{
    date: string;
    up: number;
    down: number;
    degraded: number;
    total: number;
    avgResponseTimeMs: number;
    avgTtfbMs: number;
    avgHealthScore: number;
    availabilityPct: number;
  }>> {
    // Try to read from storage repo cache (summary.json)
    // For now, return mock data - in production this would read from the storage repo
    return [];
  }

  /** Get distributions. */
  async getDistributions(): Promise<{
    status: Array<{ name: string; value: number }>;
    hosting: Array<{ name: string; value: number }>;
    cdn: Array<{ name: string; value: number }>;
    cms: Array<{ name: string; value: number }>;
    framework: Array<{ name: string; value: number }>;
    sslExpiryBuckets: Array<{ name: string; value: number }>;
    healthBuckets: Array<{ name: string; value: number }>;
    category: Array<{ name: string; value: number }>;
  }> {
    const domains = await this.readAllDomains();

    const countBy = <T,>(items: RowRecord[], key: (r: RowRecord) => T): Map<T, number> => {
      const map = new Map<T, number>();
      for (const item of items) {
        const k = key(item);
        map.set(k, (map.get(k) || 0) + 1);
      }
      return map;
    };

    const toEntries = <T,>(map: Map<T, number>) => Array.from(map.entries()).map(([name, value]) => ({ name: String(name), value }));

    return {
      status: toEntries(countBy(domains, (r) => r.record.status)),
      hosting: toEntries(countBy(domains, (r) => r.record.hostingProvider || 'Unknown')),
      cdn: toEntries(countBy(domains, (r) => r.record.cdn || 'None')),
      cms: toEntries(countBy(domains, (r) => r.record.cms || 'None')),
      framework: toEntries(countBy(domains, (r) => r.record.framework || 'None')),
      sslExpiryBuckets: toEntries(countBy(domains, (r) => {
        const days = parseInt(r.record.sslDaysRemaining, 10);
        if (isNaN(days)) return 'Unknown';
        if (days < 0) return 'Expired';
        if (days <= 7) return '0-7 days';
        if (days <= 30) return '8-30 days';
        if (days <= 90) return '31-90 days';
        return '90+ days';
      })),
      healthBuckets: toEntries(countBy(domains, (r) => {
        const score = parseInt(r.record.healthScore, 10);
        if (isNaN(score)) return 'Unknown';
        if (score >= 80) return '80-100';
        if (score >= 60) return '60-79';
        if (score >= 40) return '40-59';
        if (score >= 20) return '20-39';
        return '0-19';
      })),
      category: toEntries(countBy(domains, (r) => r.record.category || 'Uncategorized')),
    };
  }

  /** Get incidents. */
  async getIncidents(): Promise<Incident[]> {
    return this.incidentRepo.readAll();
  }

  /** Get audit log. */
  async getAuditLog(): Promise<AuditEntry[]> {
    return this.auditRepo.readAll();
  }

  /** Get import history. */
  async getImportHistory(): Promise<Record<string, string>[]> {
    return this.importRepo.readAll();
  }

  /** Get settings. */
  async getSettings(): Promise<AppSettings> {
    return this.settingsRepo.read();
  }

  /** Update settings. */
  async updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.settingsRepo.read();
    const updated = { ...current, ...settings };
    await this.settingsRepo.write(updated);
    this.cache.invalidatePrefix('settings:');
    return updated;
  }

  /** Health check for Sheets connectivity. */
  async healthCheck(): Promise<{ reachable: boolean; cacheAgeSeconds: number | null }> {
    try {
      const start = Date.now();
      await this.client.getMeta();
      const latency = Date.now() - start;

      // Check cache age
      const cached = this.cache.get<RowRecord[]>('domains:all');
      const cacheAgeSeconds = cached ? Math.floor((Date.now() - cached.timestamp) / 1000) : null;

      return { reachable: true, cacheAgeSeconds };
    } catch {
      return { reachable: false, cacheAgeSeconds: null };
    }
  }
}

/**
 * Factory that reads env vars and returns a fully-initialised SheetsService.
 * In MOCK_DATA=1 mode the credentials are optional (no real Sheet calls will
 * be made by demo routes, or they will fail gracefully).
 */
export function createSheetsClient(): SheetsService {
  const cacheService = new CacheService();
  const spreadsheetId = process.env.SHEET_ID || 'mock-sheet-id';
  const serviceAccountJsonB64 =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ||
    Buffer.from(JSON.stringify({ type: 'service_account' })).toString('base64');

  return new SheetsService({
    spreadsheetId,
    serviceAccountJsonB64,
    cacheService,
  });
}