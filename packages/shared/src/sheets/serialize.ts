/**
 * Bidirectional conversion between DomainRecord objects and raw sheet rows.
 */
import type { DomainRecord } from '../types/domain.js';
import { COLUMNS, COLUMN_COUNT } from './columns.js';
import { sanitizeSheetCell } from './sanitize.js';

/** Index of the one column allowed to hold a genuine `=IMAGE("…")` formula. */
const IMAGE_FORMULA_INDEX = COLUMNS.find((c) => c.field === 'imageFormula')?.index ?? -1;

/** An empty DomainRecord with every field set to "". */
export function emptyDomainRecord(): DomainRecord {
  const rec = {} as Record<keyof DomainRecord, string>;
  for (const col of COLUMNS) rec[col.field] = '';
  return rec as unknown as DomainRecord;
}

/**
 * Convert a raw sheet row (array of cell values) into a DomainRecord.
 * Short rows are padded; extra cells are ignored.
 */
export function rowToRecord(row: readonly unknown[]): DomainRecord {
  const rec = emptyDomainRecord() as unknown as Record<keyof DomainRecord, string>;
  for (const col of COLUMNS) {
    const cell = row[col.index];
    rec[col.field] = cell === undefined || cell === null ? '' : String(cell);
  }
  return rec as unknown as DomainRecord;
}

/**
 * Convert a DomainRecord into a raw sheet row (46 string cells, in order).
 *
 * Every cell is passed through the formula-injection sanitizer (audit C-4) so
 * that user-controlled fields (company, notes, tags, metaTitle, …) can never
 * smuggle a live formula into the sheet. The `imageFormula` column is the sole
 * exception: it may carry a strictly-shaped `=IMAGE("…")` thumbnail formula.
 */
export function recordToRow(record: DomainRecord): string[] {
  const row = new Array<string>(COLUMN_COUNT);
  for (const col of COLUMNS) {
    const raw = record[col.field] ?? '';
    row[col.index] = sanitizeSheetCell(raw, {
      allowImageFormula: col.index === IMAGE_FORMULA_INDEX,
    }) as string;
  }
  return row;
}

/**
 * Merge monitor-produced fields into an existing record without touching
 * user-owned fields. Returns a new record.
 */
export function mergeRecords(
  existing: DomainRecord,
  updates: Partial<DomainRecord>,
): DomainRecord {
  return { ...existing, ...updates };
}
