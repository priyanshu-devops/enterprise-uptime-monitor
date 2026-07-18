/**
 * Single source of truth for the `Domains` sheet tab schema.
 *
 * 46 columns, A through AT, in the exact order required by the platform spec.
 * Every module that reads or writes the sheet MUST go through this map —
 * never hardcode column letters or indices elsewhere.
 */
import type { DomainRecord } from '../types/domain.js';

/** One column definition. */
export interface ColumnDef {
  /** DomainRecord field name. */
  field: keyof DomainRecord;
  /** Human header written to row 1. */
  header: string;
  /** Column letter (A..AT). */
  letter: string;
  /** 0-based column index. */
  index: number;
}

/** Convert a 0-based column index to a sheet letter (0->A, 26->AA...). */
export function columnLetter(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

const FIELD_HEADERS: ReadonlyArray<readonly [keyof DomainRecord, string]> = [
  ['company', 'Company'],
  ['project', 'Project'],
  ['owner', 'Owner'],
  ['department', 'Department'],
  ['website', 'Website'],
  ['domain', 'Domain'],
  ['status', 'Status'],
  ['httpStatus', 'HTTP Status'],
  ['https', 'HTTPS'],
  ['redirectUrl', 'Redirect URL'],
  ['responseTime', 'Response Time'],
  ['ttfb', 'TTFB'],
  ['sslExpiry', 'SSL Expiry'],
  ['sslDaysRemaining', 'SSL Days Remaining'],
  ['sslIssuer', 'SSL Issuer'],
  ['tlsVersion', 'TLS Version'],
  ['domainExpiry', 'Domain Expiry'],
  ['serverIp', 'Server IP'],
  ['dns', 'DNS'],
  ['nameservers', 'Nameservers'],
  ['hostingProvider', 'Hosting Provider'],
  ['cdn', 'CDN'],
  ['cloudflare', 'Cloudflare'],
  ['wordpress', 'WordPress'],
  ['cms', 'CMS'],
  ['technologyStack', 'Technology Stack'],
  ['framework', 'Framework'],
  ['metaTitle', 'Meta Title'],
  ['metaDescription', 'Meta Description'],
  ['robotsTxt', 'Robots.txt'],
  ['sitemapXml', 'Sitemap.xml'],
  ['securityHeaders', 'Security Headers'],
  ['pageSize', 'Page Size'],
  ['favicon', 'Favicon'],
  ['screenshotUrl', 'Screenshot URL'],
  ['thumbnailUrl', 'Thumbnail URL'],
  ['imageFormula', 'IMAGE() Formula'],
  ['lastCheckedDate', 'Last Checked Date'],
  ['lastCheckedTime', 'Last Checked Time'],
  ['healthScore', 'Health Score'],
  ['riskScore', 'Risk Score'],
  ['errorMessage', 'Error Message'],
  ['monitoringResult', 'Monitoring Result'],
  ['notes', 'Notes'],
  ['tags', 'Tags'],
  ['category', 'Category'],
];

/** Ordered column definitions — index 0 = column A. */
export const COLUMNS: readonly ColumnDef[] = FIELD_HEADERS.map(([field, header], index) => ({
  field,
  header,
  letter: columnLetter(index),
  index,
}));

/** Total column count (46). */
export const COLUMN_COUNT = COLUMNS.length;

/** Last column letter ("AT"). */
export const LAST_COLUMN_LETTER = columnLetter(COLUMN_COUNT - 1);

/** field -> ColumnDef lookup. */
export const COLUMN_BY_FIELD: Readonly<Record<keyof DomainRecord, ColumnDef>> = Object.fromEntries(
  COLUMNS.map((c) => [c.field, c]),
) as Record<keyof DomainRecord, ColumnDef>;

/** Header row values, in order, for writing row 1. */
export const HEADER_ROW: readonly string[] = COLUMNS.map((c) => c.header);

/** Sheet tab names. */
export const SHEET_TABS = {
  domains: 'Domains',
  auditLog: 'AuditLog',
  incidentLog: 'IncidentLog',
  importHistory: 'ImportHistory',
  settings: 'Settings',
} as const;

/** Data range of the Domains tab (excludes header row). */
export const DOMAINS_DATA_RANGE = `${SHEET_TABS.domains}!A2:${LAST_COLUMN_LETTER}`;

/** Full range including header. */
export const DOMAINS_FULL_RANGE = `${SHEET_TABS.domains}!A1:${LAST_COLUMN_LETTER}`;

/** AuditLog columns. */
export const AUDIT_HEADERS = [
  'Timestamp',
  'Actor',
  'Action',
  'Target',
  'IP',
  'User Agent',
  'Status',
  'Before',
  'After',
  'Reason',
] as const;

/** IncidentLog columns. */
export const INCIDENT_HEADERS = [
  'ID',
  'Domain',
  'Type',
  'Status',
  'Opened At',
  'Resolved At',
  'From Status',
  'To Status',
  'Message',
] as const;

/** ImportHistory columns. */
export const IMPORT_HISTORY_HEADERS = [
  'Import ID',
  'Imported At',
  'Actor',
  'Source',
  'Total',
  'Accepted',
  'Duplicates',
  'Invalid',
  'Corrected',
  'Skipped',
] as const;
