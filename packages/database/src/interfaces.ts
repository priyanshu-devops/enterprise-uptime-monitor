import type {
  DomainRecord,
  AuditEntry,
  Incident,
  AppSettings
} from '@uptime/shared';

export interface IDomainsRepository {
  readAll(): Promise<{ rowNumber: number; record: DomainRecord }[]>;
  writeRecords(records: DomainRecord[]): Promise<{ updated: number; appended: number }>;
  updateFields(domain: string, fields: Partial<DomainRecord>): Promise<boolean>;
  appendRecords(records: DomainRecord[]): Promise<number>;
  deleteDomains(domains: string[]): Promise<number>;
}

export interface IAuditLogRepository {
  record(entry: AuditEntry): void;
  flush(): Promise<void>;
  readAll(): Promise<AuditEntry[]>;
}

export interface IIncidentLogRepository {
  append(incidents: Incident[]): Promise<void>;
  readAll(): Promise<Incident[]>;
  update(incidents: Incident[]): Promise<number>;
}

export interface IImportHistoryRepository {
  append(row: {
    importId: string;
    importedAt: string;
    actor: string;
    source: string;
    total: number;
    accepted: number;
    duplicates: number;
    invalid: number;
    corrected: number;
    skipped: number;
  }): Promise<void>;
  readAll(): Promise<Record<string, string>[]>;
}

export interface ISettingsRepository {
  read(): Promise<AppSettings>;
  write(settings: AppSettings): Promise<void>;
}

export interface IDatabaseProvider {
  domains: IDomainsRepository;
  audit: IAuditLogRepository;
  incidents: IIncidentLogRepository;
  imports: IImportHistoryRepository;
  settings: ISettingsRepository;
  flush(): Promise<void>;
}
