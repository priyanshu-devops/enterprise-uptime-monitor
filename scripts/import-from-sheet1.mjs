/**
 * One-time migration: import raw website list from `Sheet1` col A into the
 * structured `Domains` tab.
 *
 * Reads every non-empty cell in Sheet1!A2:A, normalizes it (URL -> clean
 * registrable domain + canonical https website), de-duplicates, sets status
 * PENDING, and appends any not already present in Domains.
 *
 * Usage: node scripts/import-from-sheet1.mjs [--source "Sheet1!A2:A"] [--dry-run]
 */
import { SheetsClient, DomainsRepository } from '../packages/gsheets/dist/index.js';
import { normalizeDomain, emptyDomainRecord } from '../packages/shared/dist/index.js';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // rely on ambient env
}

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const SOURCE_RANGE = arg('--source', 'Sheet1!A2:A');
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const spreadsheetId = process.env.SHEET_ID;
  const serviceAccountJsonB64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (!spreadsheetId || !serviceAccountJsonB64) {
    console.error('Missing SHEET_ID or GOOGLE_SERVICE_ACCOUNT_JSON_B64.');
    process.exit(1);
  }
  const client = new SheetsClient({ spreadsheetId, serviceAccountJsonB64 });

  // 1. Read raw source column.
  const [raw] = await client.batchGet([SOURCE_RANGE]);
  const cells = (raw ?? []).map((r) => (r[0] ?? '').toString().trim()).filter(Boolean);
  console.log(`Read ${cells.length} non-empty cells from ${SOURCE_RANGE}`);

  // 2. Normalize + dedupe.
  const seen = new Set();
  const records = [];
  const invalid = [];
  for (const cell of cells) {
    const n = normalizeDomain(cell);
    if (n.invalid || !n.domain) {
      invalid.push({ input: cell, reason: n.reason || 'unparseable' });
      continue;
    }
    if (seen.has(n.domain)) continue;
    seen.add(n.domain);
    records.push({
      ...emptyDomainRecord(),
      domain: n.domain,
      website: n.website,
      status: 'PENDING',
    });
  }
  console.log(`Normalized -> ${records.length} unique domains, ${invalid.length} invalid/skipped`);
  if (invalid.length) {
    console.log('First few skipped:', invalid.slice(0, 5).map((x) => x.input).join(', '));
  }

  if (DRY_RUN) {
    console.log('DRY RUN — not writing. Sample records:');
    for (const r of records.slice(0, 5)) console.log(`  ${r.domain}  (${r.website})`);
    process.exit(0);
  }

  // 3. Write to Domains tab (appends new, updates existing by domain).
  const repo = new DomainsRepository(client);
  const result = await repo.writeRecords(records);
  console.log(`Wrote to Domains tab -> appended ${result.appended}, updated ${result.updated}`);

  // 4. Confirm.
  const all = await repo.readAll();
  console.log(`Domains tab now has ${all.length} rows.`);
}

main().catch((err) => {
  console.error('import failed:', err?.message ?? err);
  process.exit(1);
});
