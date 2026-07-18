/**
 * One-time setup: creates all required tabs in the target spreadsheet and
 * writes header rows with basic formatting.
 *
 * Usage:
 *   SHEET_ID=... GOOGLE_SERVICE_ACCOUNT_JSON_B64=... pnpm setup:sheet
 */
import { SheetsClient } from '@uptime/gsheets';
import {
  AUDIT_HEADERS,
  HEADER_ROW,
  IMPORT_HISTORY_HEADERS,
  INCIDENT_HEADERS,
  LAST_COLUMN_LETTER,
  SHEET_TABS,
} from '@uptime/shared';

async function main(): Promise<void> {
  const spreadsheetId = process.env.SHEET_ID;
  const serviceAccountJsonB64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (!spreadsheetId || !serviceAccountJsonB64) {
    console.error('Missing SHEET_ID or GOOGLE_SERVICE_ACCOUNT_JSON_B64 environment variables.');
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
    { range: `${SHEET_TABS.incidentLog}!A1:I1`, values: [Array.from(INCIDENT_HEADERS)] },
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
  console.error('setup-sheet failed:', err);
  process.exit(1);
});
