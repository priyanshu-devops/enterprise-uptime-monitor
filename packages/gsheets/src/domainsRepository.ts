/**
 * High-level repository over the `Domains` tab — the platform's "database table".
 *
 * Row identity: normalized `domain` column (F). The repository maintains a
 * domain -> rowNumber map from the last full read so writes can target ranges.
 */
import {
  COLUMN_BY_FIELD,
  DOMAINS_DATA_RANGE,
  LAST_COLUMN_LETTER,
  SHEET_TABS,
  rowToRecord,
  recordToRow,
  sanitizeSheetCell,
  type DomainRecord,
} from '@uptime/shared';
import type { SheetsClient } from './client.js';

/** Chunk size for batch writes — 200 rows/call keeps well under write quotas. */
const WRITE_CHUNK_ROWS = 200;

/** A record plus its 1-based sheet row number. */
export interface RowRecord {
  rowNumber: number;
  record: DomainRecord;
}

/**
 * Repository for Domains-tab CRUD with batch semantics.
 */
export class DomainsRepository {
  private rowMap = new Map<string, number>();

  constructor(private readonly client: SheetsClient) {}

  /** Read all domain rows (single batchGet call). Rebuilds the row map. */
  async readAll(): Promise<RowRecord[]> {
    const [rows] = await this.client.batchGet([DOMAINS_DATA_RANGE]);
    this.rowMap.clear();
    const out: RowRecord[] = [];
    (rows ?? []).forEach((row, i) => {
      const record = rowToRecord(row);
      if (!record.domain && !record.website) return; // skip blank rows
      const rowNumber = i + 2; // data starts at row 2
      out.push({ rowNumber, record });
      if (record.domain) this.rowMap.set(record.domain, rowNumber);
    });
    return out;
  }

  /** Look up the sheet row number for a domain (requires a prior readAll). */
  rowNumberFor(domain: string): number | undefined {
    return this.rowMap.get(domain);
  }

  /**
   * Write full rows back for the given records. Records whose domain is not
   * in the row map are appended instead. Chunked to respect quotas.
   */
  async writeRecords(records: DomainRecord[]): Promise<{ updated: number; appended: number }> {
    const updates: { range: string; values: unknown[][] }[] = [];
    const appends: string[][] = [];

    for (const record of records) {
      const rowNumber = this.rowMap.get(record.domain);
      if (rowNumber === undefined) {
        appends.push(recordToRow(record));
      } else {
        updates.push({
          range: `${SHEET_TABS.domains}!A${rowNumber}:${LAST_COLUMN_LETTER}${rowNumber}`,
          values: [recordToRow(record)],
        });
      }
    }

    for (let i = 0; i < updates.length; i += WRITE_CHUNK_ROWS) {
      await this.client.batchUpdate(updates.slice(i, i + WRITE_CHUNK_ROWS));
    }
    for (let i = 0; i < appends.length; i += WRITE_CHUNK_ROWS) {
      await this.client.append(DOMAINS_DATA_RANGE, appends.slice(i, i + WRITE_CHUNK_ROWS));
    }
    return { updated: updates.length, appended: appends.length };
  }

  /**
   * Update only specific fields for one domain (partial write of single cells
   * grouped into one batchUpdate call).
   */
  async updateFields(domain: string, fields: Partial<DomainRecord>): Promise<boolean> {
    const rowNumber = this.rowMap.get(domain);
    if (rowNumber === undefined) return false;
    const data = Object.entries(fields).map(([field, value]) => {
      const col = COLUMN_BY_FIELD[field as keyof DomainRecord];
      // Sanitize per-cell (audit C-4). Only the imageFormula column may carry a
      // genuine =IMAGE("…") formula; every other field is forced to literal text.
      const cell = sanitizeSheetCell(value ?? '', {
        allowImageFormula: field === 'imageFormula',
      });
      return {
        range: `${SHEET_TABS.domains}!${col.letter}${rowNumber}`,
        values: [[cell]],
      };
    });
    await this.client.batchUpdate(data);
    return true;
  }

  /** Append brand-new records (no dedupe here — callers dedupe first). */
  async appendRecords(records: DomainRecord[]): Promise<number> {
    const rows = records.map(recordToRow);
    for (let i = 0; i < rows.length; i += WRITE_CHUNK_ROWS) {
      await this.client.append(DOMAINS_DATA_RANGE, rows.slice(i, i + WRITE_CHUNK_ROWS));
    }
    return rows.length;
  }

  /**
   * Delete rows for the given domains. Deletes bottom-up so indices stay
   * valid, one API call per contiguous block.
   */
  async deleteDomains(domains: string[]): Promise<number> {
    const meta = await this.client.getMeta();
    const tab = meta.tabs.find((t) => t.title === SHEET_TABS.domains);
    if (!tab) throw new Error(`Tab ${SHEET_TABS.domains} not found`);

    const rowNumbers = domains
      .map((d) => this.rowMap.get(d))
      .filter((n): n is number => n !== undefined)
      .sort((a, b) => b - a); // bottom-up

    // Merge contiguous descending runs into blocks
    let deleted = 0;
    let i = 0;
    while (i < rowNumbers.length) {
      let end = rowNumbers[i]!; // 1-based inclusive
      let start = end;
      while (i + 1 < rowNumbers.length && rowNumbers[i + 1] === start - 1) {
        i++;
        start = rowNumbers[i]!;
      }
      // deleteDimension uses 0-based [startIndex, endIndex)
      await this.client.deleteRows(tab.sheetId, start - 1, end);
      deleted += end - start + 1;
      i++;
    }
    // Row map is now stale — callers must readAll() before further writes.
    this.rowMap.clear();
    return deleted;
  }
}
