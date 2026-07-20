import pino from 'pino';
import crypto from 'node:crypto';
import type { IDomainsRepository } from '@uptime/database';
import type { DomainRecord, ImportRowPreview, ImportReport } from '@uptime/shared';
import { emptyDomainRecord, normalizeDomain } from '@uptime/shared';
import type { CacheService } from './cache.js';

const logger = pino({ name: 'domain-service' });

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

export type RowRecord = { rowNumber: number; record: DomainRecord };

export class DomainService {
  // Prevent cache stampedes
  private readPromise: Promise<RowRecord[]> | null = null;

  constructor(
    private readonly provider: import('@uptime/database').IDatabaseProvider,
    private readonly cache: CacheService
  ) {}

  private get repo() {
    return this.provider.domains;
  }

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

    if (this.readPromise) {
      return this.readPromise;
    }

    this.readPromise = (async () => {
      try {
        logger.info('Reading domains from database...');
        const domains = await this.repo.readAll();
        this.cache.set(cacheKey, domains, ttlSeconds);
        return domains;
      } finally {
        this.readPromise = null;
      }
    })();

    return this.readPromise;
  }

  async getDomains(query: DomainQuery = {}): Promise<PaginatedResult<RowRecord>> {
    const domains = await this.readAllDomains();
    let filtered = domains;

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

    const sortBy = query.sortBy || 'domain';
    const sortDir = query.sortDir || 'asc';
    filtered.sort((a, b) => {
      const aVal = a.record[sortBy];
      const bVal = b.record[sortBy];
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 1000;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return {
      items,
      total: filtered.length,
      page,
      pageSize,
    };
  }

  async getDomain(domain: string): Promise<RowRecord | null> {
    const domains = await this.readAllDomains();
    return domains.find((r) => r.record.domain === domain) || null;
  }



  async createDomains(records: DomainRecord[]): Promise<number> {
    const count = await this.repo.appendRecords(records);
    this.cache.invalidatePrefix('domains:all');
    return count;
  }

  async createDomain(
    data: Partial<DomainRecord>,
    actor: string,
    ip: string,
    userAgent: string
  ): Promise<RowRecord> {
    const normalized = normalizeDomain(data.website || '');
    if (normalized.invalid) throw new Error(`Invalid website: ${normalized.reason}`);

    const existing = await this.getDomain(normalized.domain);
    if (existing) throw new Error(`Domain already exists: ${normalized.domain}`);

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

    await this.repo.appendRecords([record]);
    await this.provider.audit.record({
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

    this.cache.invalidatePrefix('domains:all');
    return { rowNumber: 0, record };
  }

  async updateDomain(
    domain: string,
    data: Partial<DomainRecord>,
    actor: string,
    ip: string,
    userAgent: string
  ): Promise<RowRecord> {
    await this.readAllDomains();
    const existing = await this.getDomain(domain);
    if (!existing) throw new Error(`Domain not found: ${domain}`);

    const before = { ...existing.record };
    const allowedFields = ['company', 'project', 'owner', 'department', 'website', 'notes', 'tags', 'category'] as const;

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        if (field === 'website' && data.website) {
          const normalized = normalizeDomain(data.website);
          if (normalized.invalid) throw new Error(`Invalid website: ${normalized.reason}`);
          if (normalized.domain !== domain) {
            const conflict = await this.getDomain(normalized.domain);
            if (conflict) throw new Error(`Domain already exists: ${normalized.domain}`);
            existing.record.domain = normalized.domain;
            existing.record.website = normalized.website;
          }
        } else {
          (existing.record as any)[field] = data[field];
        }
      }
    }

    await this.repo.updateFields(domain, existing.record);
    await this.provider.audit.record({
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

    this.cache.invalidatePrefix('domains:all');
    return existing;
  }

  async deleteDomains(domains: string[], actor: string, ip: string, userAgent: string): Promise<number> {
    await this.readAllDomains();
    const deleted = await this.repo.deleteDomains(domains);
    if (deleted > 0) {
      await this.provider.audit.record({
        timestamp: new Date().toISOString(),
        actor,
        action: 'DELETE',
        target: `${domains.length} domains`,
        ip,
        userAgent,
        status: 'success',
        before: JSON.stringify(domains),
        after: '',
        reason: 'Bulk delete via API',
      });
      this.cache.invalidatePrefix('domains:all');
    }
    return deleted;
  }

  async bulkUpdate(domains: string[], fields: Partial<DomainRecord>): Promise<number> {
    await this.readAllDomains();
    let updated = 0;
    for (const d of domains) {
      const success = await this.repo.updateFields(d, fields);
      if (success) updated++;
    }
    if (updated > 0) {
      this.cache.invalidatePrefix('domains:all');
    }
    return updated;
  }

  async bulkDomains(
    action: 'delete' | 'tag' | 'untag' | 'categorize' | 'pause' | 'resume',
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

      await this.repo.updateFields(domain, row.record);
      await this.provider.audit.record({
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

    if (updated > 0) this.cache.invalidatePrefix('domains:all');
    return updated;
  }

  async importDomains(
    rows: import('@uptime/shared').ImportRowPreview[],
    actor: string,
    ip: string,
    userAgent: string,
    source: string,
  ): Promise<import('@uptime/shared').ImportReport> {
    const existing = await this.readAllDomains();
    const known = new Set(existing.map((r) => r.record.domain));

    const toImport: DomainRecord[] = [];
    const rejected: import('@uptime/shared').ImportRowPreview[] = [];
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
      await this.repo.appendRecords(toImport);
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

    this.cache.invalidatePrefix('domains:');
    return report;
  }

  async getKpis() {
    const domains = await this.readAllDomains();
    const total = domains.length;
    let healthy = 0;
    let down = 0;
    let degraded = 0;
    let paused = 0;
    let sslExpiringSoon = 0;
    let sslExpired = 0;
    let redirectIssues = 0;
    let dnsIssues = 0;

    let totalResponseTime = 0;
    let totalTtfb = 0;
    let totalHealth = 0;
    let totalRisk = 0;

    let cloudflareCount = 0;
    let wordpressCount = 0;
    let httpsCount = 0;

    for (const d of domains) {
      const r = d.record;
      if (r.status === 'UP') healthy++;
      else if (r.status === 'DOWN') down++;
      else if (r.status === 'DEGRADED') degraded++;
      else if (r.status === 'PAUSED') paused++;
      else if (r.status === 'SSL_ERROR') sslExpired++;
      else if (r.status === 'REDIRECT') redirectIssues++;
      else if (r.status === 'DNS_FAILURE') dnsIssues++;

      const sslDays = parseInt(r.sslDaysRemaining, 10);
      if (!isNaN(sslDays) && sslDays > 0 && sslDays <= 14) sslExpiringSoon++;
      if (!isNaN(sslDays) && sslDays <= 0 && r.status !== 'SSL_ERROR') sslExpired++;

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

  async getDistributions() {
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
}
