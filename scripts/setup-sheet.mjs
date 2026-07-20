/**
 * One-time sheet setup — plain-Node runner.
 *
 * Mirrors scripts/setup-sheet.ts but imports the compiled dist directly so it
 * runs under `node` without tsx's workspace-exports resolution quirk. Creates
 * every required tab and writes header rows into the target spreadsheet.
 *
 * Usage: node scripts/setup-sheet.mjs   (reads .env from repo root)
 */
import { SheetsClient } from '../packages/gsheets/dist/index.js';
import {
  AUDIT_HEADERS,
  HEADER_ROW,
  IMPORT_HISTORY_HEADERS,
  INCIDENT_HEADERS,
  LAST_COLUMN_LETTER,
  SHEET_TABS,
} from '../packages/shared/dist/index.js';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // No .env — rely on ambient environment.
}

async function main() {
  const spreadsheetId = process.env.SHEET_ID;
  const serviceAccountJsonB64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (!spreadsheetId || !serviceAccountJsonB64) {
    console.error('Missing SHEET_ID or GOOGLE_SERVICE_ACCOUNT_JSON_B64.');
    process.exit(1);
  }

  const client = new SheetsClient({ spreadsheetId, serviceAccountJsonB64 });

  console.log('Ensuring tabs exist...');
  const created = await client.ensureTabs(Object.values(SHEET_TABS));
  console.log(created.length ? `Created tabs: ${created.join(', ')}` : 'All tabs already exist.');

  console.log('Writing header rows...');
  await client.batchUpdate([
    { range: `${SHEET_TABS.domains}!A1:${LAST_COLUMN_LETTER}1`, values: [Array.from(HEADER_ROW)] },
    { range: `${SHEET_TABS.auditLog}!A1:J1`, values: [Array.from(AUDIT_HEADERS)] },
    { range: `${SHEET_TABS.incidentLog}!A1:L1`, values: [Array.from(INCIDENT_HEADERS)] },
    { range: `${SHEET_TABS.importHistory}!A1:J1`, values: [Array.from(IMPORT_HISTORY_HEADERS)] },
    { range: `${SHEET_TABS.settings}!A1:B1`, values: [['Key', 'Value']] },
    {
      range: `${SHEET_TABS.settings}!A2:B4`,
      values: [
        ['sslWarnDays', '30'],
        ['responseTimeWarnMs', '3000'],
        ['savedFilters', '[]'],
      ],
    },
  ]);

  const meta = await client.getMeta();
  console.log(`Spreadsheet "${meta.title}" ready with tabs: ${meta.tabs.map((t) => t.title).join(', ')}`);
}

main().catch((err) => {
  console.error('setup-sheet failed:', err?.message ?? err);
  process.exit(1);
});
