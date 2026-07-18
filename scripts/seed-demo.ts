/**
 * Seed the Domains tab with the demo fixture list (fixtures/domains-10.csv).
 *
 * Usage:
 *   SHEET_ID=... GOOGLE_SERVICE_ACCOUNT_JSON_B64=... pnpm seed:demo
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SheetsClient, DomainsRepository } from '@uptime/gsheets';
import { emptyDomainRecord, normalizeDomain, type DomainRecord } from '@uptime/shared';

const here = dirname(fileURLToPath(import.meta.url));

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  const headers = splitCsvLine(lines[0] ?? '');
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ''));
    return row;
  });
}

/** Minimal CSV line splitter with quoted-field support. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function main(): Promise<void> {
  const spreadsheetId = process.env.SHEET_ID;
  const serviceAccountJsonB64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (!spreadsheetId || !serviceAccountJsonB64) {
    console.error('Missing SHEET_ID or GOOGLE_SERVICE_ACCOUNT_JSON_B64.');
    process.exit(1);
  }

  const csv = readFileSync(join(here, '..', 'fixtures', 'domains-10.csv'), 'utf8');
  const rows = parseCsv(csv);

  const client = new SheetsClient({ spreadsheetId, serviceAccountJsonB64 });
  const repo = new DomainsRepository(client);
  const existing = await repo.readAll();
  const known = new Set(existing.map((r) => r.record.domain));

  const records: DomainRecord[] = [];
  for (const row of rows) {
    const norm = normalizeDomain(row['Website'] ?? '');
    if (norm.invalid) {
      console.warn(`Skipping invalid website: ${row['Website']} (${norm.reason})`);
      continue;
    }
    if (known.has(norm.domain)) {
      console.log(`Already present: ${norm.domain}`);
      continue;
    }
    const rec = emptyDomainRecord();
    rec.company = row['Company'] ?? '';
    rec.project = row['Project'] ?? '';
    rec.owner = row['Owner'] ?? '';
    rec.department = row['Department'] ?? '';
    rec.website = norm.website;
    rec.domain = norm.domain;
    rec.status = 'PENDING';
    rec.tags = row['Tags'] ?? '';
    rec.category = row['Category'] ?? '';
    records.push(rec);
  }

  if (records.length === 0) {
    console.log('Nothing to seed.');
    return;
  }
  const added = await repo.appendRecords(records);
  console.log(`Seeded ${added} demo domains.`);
}

main().catch((err) => {
  console.error('seed-demo failed:', err);
  process.exit(1);
});
