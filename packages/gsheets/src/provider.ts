import type { IDatabaseProvider } from '@uptime/database';
import { SheetsClient, type SheetsClientConfig } from './client.js';
import { DomainsRepository } from './domainsRepository.js';
import {
  AuditLogRepository,
  IncidentLogRepository,
  ImportHistoryRepository,
  SettingsRepository
} from './logRepositories.js';

export class GSheetsDatabaseProvider implements IDatabaseProvider {
  public readonly domains: DomainsRepository;
  public readonly audit: AuditLogRepository;
  public readonly incidents: IncidentLogRepository;
  public readonly imports: ImportHistoryRepository;
  public readonly settings: SettingsRepository;

  constructor(config: SheetsClientConfig) {
    const client = new SheetsClient(config);
    this.domains = new DomainsRepository(client);
    this.audit = new AuditLogRepository(client);
    this.incidents = new IncidentLogRepository(client);
    this.imports = new ImportHistoryRepository(client);
    this.settings = new SettingsRepository(client);
  }

  async flush(): Promise<void> {
    await this.audit.flush();
  }
}
