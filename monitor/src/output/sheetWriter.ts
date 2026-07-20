/**
 * Sheet writer.
 *
 * Merges monitor-owned field updates into existing Domains-tab rows (preserving
 * user-owned columns) and writes them back in quota-safe chunks, then appends
 * detected incidents to the IncidentLog tab. Runs only in the aggregate step,
 * against the full merged result set.
 */
import {
  mergeRecords,
  type CheckResult,
  type DomainRecord,
  type Incident,
} from '@uptime/shared';
import {
  DomainsRepository,
  IncidentLogRepository,
  SheetsClient,
} from '@uptime/gsheets';
import type { MonitorConfig } from '../config.js';
import type { Logger } from '../logging.js';
import { resultToRecordUpdate } from './mapResult.js';

/** Result of the sheet write. */
export interface SheetWriteResult {
  updated: number;
  appended: number;
  incidents: number;
  /** Records after merge, for the cache writer. */
  records: DomainRecord[];
}

/**
 * Write the run's results to the sheet.
 *
 * @param results Merged results (deduped by domain) from all shards.
 * @param opened Newly opened incidents (appended to the IncidentLog tab).
 * @param resolved Incidents resolved this run (updated in place by id).
 * @param config Engine config (sheet id + creds + pages url).
 * @param logger Logger.
 */
export async function writeToSheet(
  results: CheckResult[],
  opened: Incident[],
  resolved: Incident[],
  config: MonitorConfig,
  logger: Logger,
): Promise<SheetWriteResult> {
  const client = new SheetsClient({
    spreadsheetId: config.sheetId,
    serviceAccountJsonB64: config.serviceAccountJsonB64,
  });
  const domainsRepo = new DomainsRepository(client);

  // Full read to establish the domain -> row map and existing user fields.
  const existing = await domainsRepo.readAll();
  const byDomain = new Map<string, DomainRecord>();
  for (const { record } of existing) byDomain.set(record.domain, record);

  logger.info('Loaded existing rows', { rows: existing.length });

  const merged: DomainRecord[] = [];
  for (const result of results) {
    const current = byDomain.get(result.domain);
    const update = resultToRecordUpdate(result, config.pagesBaseUrl);
    if (current) {
      merged.push(mergeRecords(current, update));
    } else {
      // Domain checked but not in the sheet (e.g. added via --domains): create a
      // minimal record so it still gets written.
      merged.push(
        mergeRecords(
          {
            ...blankRecord(),
            website: result.website,
            domain: result.domain,
          },
          update,
        ),
      );
    }
  }

  const writeResult = await domainsRepo.writeRecords(merged);
  logger.info('Wrote domain rows', writeResult);

  let incidentCount = 0;
  if (opened.length > 0 || resolved.length > 0) {
    const incidentRepo = new IncidentLogRepository(client);
    if (opened.length > 0) {
      await incidentRepo.append(opened);
      logger.info('Appended incidents', { count: opened.length });
    }
    if (resolved.length > 0) {
      const updated = await incidentRepo.update(resolved);
      logger.info('Resolved incidents in ledger', { requested: resolved.length, updated });
    }
    incidentCount = opened.length + resolved.length;
  }

  return {
    updated: writeResult.updated,
    appended: writeResult.appended,
    incidents: incidentCount,
    records: merged,
  };
}

/** A DomainRecord with every field empty (avoids importing serialize here). */
function blankRecord(): DomainRecord {
  return {
    company: '',
    project: '',
    owner: '',
    department: '',
    website: '',
    domain: '',
    status: '',
    httpStatus: '',
    https: '',
    redirectUrl: '',
    responseTime: '',
    ttfb: '',
    sslExpiry: '',
    sslDaysRemaining: '',
    sslIssuer: '',
    tlsVersion: '',
    domainExpiry: '',
    serverIp: '',
    dns: '',
    nameservers: '',
    hostingProvider: '',
    cdn: '',
    cloudflare: '',
    wordpress: '',
    cms: '',
    technologyStack: '',
    framework: '',
    metaTitle: '',
    metaDescription: '',
    robotsTxt: '',
    sitemapXml: '',
    securityHeaders: '',
    pageSize: '',
    favicon: '',
    screenshotUrl: '',
    thumbnailUrl: '',
    imageFormula: '',
    lastCheckedDate: '',
    lastCheckedTime: '',
    healthScore: '',
    riskScore: '',
    errorMessage: '',
    monitoringResult: '',
    notes: '',
    tags: '',
    category: '',
  };
}
