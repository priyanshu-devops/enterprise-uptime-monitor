import type { IDatabaseProvider } from '@uptime/database';
import { createSupabase, type SupabaseConfig } from './client.js';
import { SupabaseDomainsRepository } from './domainsRepository.js';
import {
  SupabaseAuditLogRepository,
  SupabaseIncidentLogRepository,
  SupabaseImportHistoryRepository,
  SupabaseSettingsRepository
} from './logRepositories.js';

export class SupabaseDatabaseProvider implements IDatabaseProvider {
  public readonly domains: SupabaseDomainsRepository;
  public readonly audit: SupabaseAuditLogRepository;
  public readonly incidents: SupabaseIncidentLogRepository;
  public readonly imports: SupabaseImportHistoryRepository;
  public readonly settings: SupabaseSettingsRepository;

  constructor(config: SupabaseConfig) {
    const supabase = createSupabase(config);
    this.domains = new SupabaseDomainsRepository(supabase);
    this.audit = new SupabaseAuditLogRepository(supabase);
    this.incidents = new SupabaseIncidentLogRepository(supabase);
    this.imports = new SupabaseImportHistoryRepository(supabase);
    this.settings = new SupabaseSettingsRepository(supabase);
  }

  async flush(): Promise<void> {
    await this.audit.flush();
  }
}
