/**
 * Low-level Google Sheets client with authentication, retry/backoff, and
 * quota-aware batch operations. Shared by the monitor engine and backend API.
 */
import { google, type sheets_v4 } from 'googleapis';

/** Configuration for the Sheets client. */
export interface SheetsClientConfig {
  /** Spreadsheet ID (from the sheet URL). */
  spreadsheetId: string;
  /** Base64-encoded service-account JSON key. */
  serviceAccountJsonB64: string;
  /** Max retry attempts for retryable errors (default 6). */
  maxRetries?: number;
}

/** Errors worth retrying: rate limits and transient server faults. */
const RETRYABLE_CODES = new Set([429, 500, 502, 503]);

/** Sleep helper. */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Wrap a Google API call with exponential backoff + jitter.
 * Honors Retry-After when present.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 6,
  label = 'sheets-op',
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = extractStatus(err);
      if (status === null || !RETRYABLE_CODES.has(status) || attempt === maxRetries) {
        throw err;
      }
      const retryAfterMs = extractRetryAfterMs(err);
      const backoff = Math.min(500 * 2 ** attempt, 32_000);
      const jitter = Math.floor(Math.random() * 400);
      const delay = retryAfterMs ?? backoff + jitter;
      // eslint-disable-next-line no-console
      console.warn(`[${label}] HTTP ${status}, retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastError;
}

function extractStatus(err: unknown): number | null {
  if (typeof err === 'object' && err !== null) {
    const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } };
    for (const candidate of [e.code, e.status, e.response?.status]) {
      if (typeof candidate === 'number') return candidate;
    }
  }
  return null;
}

function extractRetryAfterMs(err: unknown): number | null {
  if (typeof err === 'object' && err !== null) {
    const headers = (err as { response?: { headers?: Record<string, string> } }).response?.headers;
    const ra = headers?.['retry-after'];
    if (ra) {
      const seconds = Number(ra);
      if (Number.isFinite(seconds)) return seconds * 1000;
    }
  }
  return null;
}

/**
 * Authenticated Google Sheets API client with batch helpers.
 */
export class SheetsClient {
  private readonly sheets: sheets_v4.Sheets;
  private readonly spreadsheetId: string;
  private readonly maxRetries: number;

  constructor(config: SheetsClientConfig) {
    const keyJson = JSON.parse(
      Buffer.from(config.serviceAccountJsonB64, 'base64').toString('utf8'),
    ) as { client_email: string; private_key: string };
    const auth = new google.auth.JWT({
      email: keyJson.client_email,
      key: keyJson.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.sheets = google.sheets({ version: 'v4', auth });
    this.spreadsheetId = config.spreadsheetId;
    this.maxRetries = config.maxRetries ?? 6;
  }

  /** Read multiple ranges in a single API call. */
  async batchGet(ranges: string[]): Promise<(unknown[][] | undefined)[]> {
    const res = await withRetry(
      () =>
        this.sheets.spreadsheets.values.batchGet({
          spreadsheetId: this.spreadsheetId,
          ranges,
          valueRenderOption: 'UNFORMATTED_VALUE',
          dateTimeRenderOption: 'FORMATTED_STRING',
        }),
      this.maxRetries,
      'batchGet',
    );
    return (res.data.valueRanges ?? []).map((vr) => vr.values as unknown[][] | undefined);
  }

  /**
   * Write values to multiple ranges. Uses USER_ENTERED so =IMAGE() formulas
   * evaluate. Chunk large updates before calling.
   */
  async batchUpdate(data: { range: string; values: unknown[][] }[]): Promise<void> {
    if (data.length === 0) return;
    await withRetry(
      () =>
        this.sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: data.map((d) => ({ range: d.range, values: d.values })),
          },
        }),
      this.maxRetries,
      'batchUpdate',
    );
  }

  /** Append rows to a table (finds the table end automatically). */
  async append(range: string, values: unknown[][]): Promise<void> {
    if (values.length === 0) return;
    await withRetry(
      () =>
        this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values },
        }),
      this.maxRetries,
      'append',
    );
  }

  /** Clear a range. */
  async clear(range: string): Promise<void> {
    await withRetry(
      () => this.sheets.spreadsheets.values.clear({ spreadsheetId: this.spreadsheetId, range }),
      this.maxRetries,
      'clear',
    );
  }

  /** Delete rows (0-based, endIndex exclusive) from a tab by sheetId. */
  async deleteRows(sheetId: number, startIndex: number, endIndex: number): Promise<void> {
    await withRetry(
      () =>
        this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [
              {
                deleteDimension: {
                  range: { sheetId, dimension: 'ROWS', startIndex, endIndex },
                },
              },
            ],
          },
        }),
      this.maxRetries,
      'deleteRows',
    );
  }

  /** Fetch spreadsheet metadata (tab names + sheetIds). */
  async getMeta(): Promise<{ title: string; tabs: { title: string; sheetId: number; rowCount: number }[] }> {
    const res = await withRetry(
      () => this.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId }),
      this.maxRetries,
      'getMeta',
    );
    return {
      title: res.data.properties?.title ?? '',
      tabs: (res.data.sheets ?? []).map((s) => ({
        title: s.properties?.title ?? '',
        sheetId: s.properties?.sheetId ?? 0,
        rowCount: s.properties?.gridProperties?.rowCount ?? 0,
      })),
    };
  }

  /** Create tabs that don't exist yet. Returns names actually created. */
  async ensureTabs(tabNames: string[]): Promise<string[]> {
    const meta = await this.getMeta();
    const existing = new Set(meta.tabs.map((t) => t.title));
    const missing = tabNames.filter((t) => !existing.has(t));
    if (missing.length === 0) return [];
    await withRetry(
      () =>
        this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
          },
        }),
      this.maxRetries,
      'ensureTabs',
    );
    return missing;
  }
}
