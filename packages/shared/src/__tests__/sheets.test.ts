import { describe, expect, it } from 'vitest';
import { COLUMNS, COLUMN_COUNT, LAST_COLUMN_LETTER, columnLetter, HEADER_ROW } from '../sheets/columns.js';
import { emptyDomainRecord, recordToRow, rowToRecord } from '../sheets/serialize.js';

describe('columns', () => {
  it('has exactly 46 columns ending at AT', () => {
    expect(COLUMN_COUNT).toBe(46);
    expect(LAST_COLUMN_LETTER).toBe('AT');
  });

  it('assigns sequential letters A, B, ..., Z, AA, ..., AT', () => {
    expect(COLUMNS[0]!.letter).toBe('A');
    expect(COLUMNS[25]!.letter).toBe('Z');
    expect(COLUMNS[26]!.letter).toBe('AA');
    expect(COLUMNS[45]!.letter).toBe('AT');
  });

  it('columnLetter handles multi-letter columns', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(51)).toBe('AZ');
    expect(columnLetter(52)).toBe('BA');
  });

  it('has the spec headers in order', () => {
    expect(HEADER_ROW[0]).toBe('Company');
    expect(HEADER_ROW[5]).toBe('Domain');
    expect(HEADER_ROW[36]).toBe('IMAGE() Formula');
    expect(HEADER_ROW[45]).toBe('Category');
  });
});

describe('serialize', () => {
  it('round-trips a record through a row', () => {
    const rec = emptyDomainRecord();
    rec.company = 'Acme';
    rec.domain = 'example.com';
    rec.website = 'https://example.com';
    rec.status = 'UP';
    rec.healthScore = '95';
    rec.category = 'Marketing';

    const row = recordToRow(rec);
    expect(row).toHaveLength(46);
    expect(row[0]).toBe('Acme');
    expect(row[5]).toBe('example.com');
    expect(row[45]).toBe('Marketing');

    const back = rowToRecord(row);
    expect(back).toEqual(rec);
  });

  it('pads short rows and ignores extras', () => {
    const rec = rowToRecord(['Acme', 'Proj']);
    expect(rec.company).toBe('Acme');
    expect(rec.project).toBe('Proj');
    expect(rec.category).toBe('');
    const rec2 = rowToRecord(new Array(60).fill('x'));
    expect(rec2.category).toBe('x');
  });

  it('stringifies non-string cells', () => {
    const rec = rowToRecord(['Acme', 42, true, null]);
    expect(rec.project).toBe('42');
    expect(rec.owner).toBe('true');
    expect(rec.department).toBe('');
  });
});
