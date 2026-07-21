import pino from 'pino';
import { GSheetsDatabaseProvider } from '@uptime/gsheets';
import { SupabaseDatabaseProvider } from '@uptime/supabase';

const logger = pino({ name: 'migration' });

async function migrate() {
  logger.info('Starting migration from Google Sheets to Supabase...');

  // 1. Initialize Google Sheets provider
  const spreadsheetId = process.env.SHEET_ID;
  const serviceAccountJsonB64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (!spreadsheetId || !serviceAccountJsonB64) {
    throw new Error('Missing Google Sheets credentials in .env');
  }

  const gsheets = new GSheetsDatabaseProvider({
    spreadsheetId,
    serviceAccountJsonB64,
  });

  // 2. Initialize Supabase provider
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  }

  const supabase = new SupabaseDatabaseProvider({
    url,
    serviceRoleKey,
  });

  try {
    logger.info('Reading data from Google Sheets...');
    
    const settings = await gsheets.settings.read();
    const domains = await gsheets.domains.readAll();
    const auditLogs = await gsheets.audit.readAll();
    const incidentLogs = await gsheets.incidents.readAll();
    const importHistory = await gsheets.imports.readAll();

    logger.info({
      settingsCount: Object.keys(settings).length,
      domainsCount: domains.length,
      auditLogsCount: auditLogs.length,
      incidentLogsCount: incidentLogs.length,
      importHistoryCount: importHistory.length
    }, 'Data read successfully. Beginning transfer to Supabase...');

    // 3. Write data to Supabase
    await supabase.settings.write(settings);
    logger.info('✅ Settings migrated');

    if (domains.length > 0) {
      await supabase.domains.writeRecords(domains.map(d => d.record));
      logger.info(`✅ ${domains.length} Domains migrated`);
    }

    if (auditLogs.length > 0) {
      for (const log of auditLogs) {
        supabase.audit.record(log);
      }
      await supabase.audit.flush();
      logger.info(`✅ ${auditLogs.length} Audit logs migrated`);
    }

    if (incidentLogs.length > 0) {
      await supabase.incidents.update(incidentLogs);
      logger.info(`✅ ${incidentLogs.length} Incident logs migrated`);
    }

    if (importHistory.length > 0) {
      for (const imp of importHistory) {
        await supabase.imports.append({
          importId: imp.importId || '',
          importedAt: imp.importedAt || '',
          actor: imp.actor || '',
          source: imp.source || '',
          total: parseInt(imp.total || '0', 10),
          accepted: parseInt(imp.accepted || '0', 10),
          duplicates: parseInt(imp.duplicates || '0', 10),
          invalid: parseInt(imp.invalid || '0', 10),
          corrected: parseInt(imp.corrected || '0', 10),
          skipped: parseInt(imp.skipped || '0', 10)
        });
      }
      logger.info(`✅ ${importHistory.length} Import history records migrated`);
    }

    logger.info('🎉 Migration completed successfully!');
    logger.info('You can now set DATABASE_PROVIDER=supabase in your .env file.');
  } catch (error) {
    logger.error({ err: error }, 'Migration failed');
    process.exit(1);
  }
}

migrate();
