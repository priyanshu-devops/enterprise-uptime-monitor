import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditEntry, Incident, AppSettings } from '@uptime/shared';
import type { IAuditLogRepository, IIncidentLogRepository, IImportHistoryRepository, ISettingsRepository } from '@uptime/database';

export class SupabaseAuditLogRepository implements IAuditLogRepository {
  private buffer: AuditEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly flushEvery = 10,
    private readonly flushMs = 30_000
  ) {}

  record(entry: AuditEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length >= this.flushEvery) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.flushMs);
      if (typeof this.timer === 'object' && 'unref' in this.timer) this.timer.unref();
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return;
    
    const entries = this.buffer;
    this.buffer = [];

    const rows = entries.map(e => ({
      timestamp: e.timestamp,
      actor: e.actor,
      action: e.action,
      target: e.target,
      ip: e.ip,
      user_agent: e.userAgent,
      status: e.status,
      before: e.before,
      after: e.after,
      reason: e.reason
    }));

    const { error } = await this.supabase.from('audit_logs').insert(rows);
    if (error) {
      this.buffer = entries.concat(this.buffer);
      throw error;
    }
  }

  async readAll(): Promise<AuditEntry[]> {
    const { data, error } = await this.supabase
      .from('audit_logs')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;

    return (data || []).map(row => ({
      timestamp: row.timestamp || '',
      actor: row.actor || '',
      action: row.action || '',
      target: row.target || '',
      ip: row.ip || '',
      userAgent: row.user_agent || '',
      status: (row.status as AuditEntry['status']) || 'success',
      before: row.before || '',
      after: row.after || '',
      reason: row.reason || ''
    }));
  }
}

export class SupabaseIncidentLogRepository implements IIncidentLogRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async append(incidents: Incident[]): Promise<void> {
    if (incidents.length === 0) return;
    
    const rows = incidents.map(i => this.mapToRow(i));
    const { error } = await this.supabase.from('incident_logs').insert(rows);
    if (error) throw error;
  }

  async readAll(): Promise<Incident[]> {
    const { data, error } = await this.supabase
      .from('incident_logs')
      .select('*')
      .order('opened_at', { ascending: true });

    if (error) throw error;
    
    return (data || []).map(row => this.mapToIncident(row));
  }

  async update(incidents: Incident[]): Promise<number> {
    if (incidents.length === 0) return 0;
    
    const rows = incidents.map(i => this.mapToRow(i));
    const { data, error } = await this.supabase
      .from('incident_logs')
      .upsert(rows, { onConflict: 'id' })
      .select('id');

    if (error) throw error;
    return data?.length || 0;
  }

  private mapToRow(i: Incident) {
    return {
      id: i.id,
      domain: i.domain,
      type: i.type,
      status: i.status,
      opened_at: i.openedAt,
      resolved_at: i.resolvedAt || null,
      from_status: i.fromStatus,
      to_status: i.toStatus,
      message: i.message,
      duration_seconds: i.durationSeconds || null,
      acked_at: i.ackedAt || null,
      acked_by: i.ackedBy || '',
      updated_at: new Date().toISOString()
    };
  }

  private mapToIncident(row: any): Incident {
    return {
      id: row.id || '',
      domain: row.domain || '',
      type: row.type as Incident['type'],
      status: row.status as Incident['status'] || 'open',
      openedAt: row.opened_at || '',
      resolvedAt: row.resolved_at || null,
      fromStatus: row.from_status || '',
      toStatus: row.to_status || '',
      message: row.message || '',
      durationSeconds: row.duration_seconds || null,
      ackedAt: row.acked_at || null,
      ackedBy: row.acked_by || ''
    };
  }
}

export class SupabaseImportHistoryRepository implements IImportHistoryRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async append(row: {
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
  }): Promise<void> {
    const { error } = await this.supabase.from('import_history').insert({
      import_id: row.importId,
      imported_at: row.importedAt,
      actor: row.actor,
      source: row.source,
      total_rows: row.total,
      accepted: row.accepted,
      duplicates: row.duplicates,
      invalid: row.invalid,
      corrected: row.corrected,
      skipped: row.skipped
    });
    
    if (error) throw error;
  }

  async readAll(): Promise<Record<string, string>[]> {
    const { data, error } = await this.supabase
      .from('import_history')
      .select('*')
      .order('imported_at', { ascending: true });

    if (error) throw error;

    return (data || []).map(row => ({
      importId: row.import_id || '',
      importedAt: row.imported_at || '',
      actor: row.actor || '',
      source: row.source || '',
      total: String(row.total_rows || '0'),
      accepted: String(row.accepted || '0'),
      duplicates: String(row.duplicates || '0'),
      invalid: String(row.invalid || '0'),
      corrected: String(row.corrected || '0'),
      skipped: String(row.skipped || '0'),
    }));
  }
}

export class SupabaseSettingsRepository implements ISettingsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async read(): Promise<AppSettings> {
    const { data, error } = await this.supabase.from('settings').select('*');
    if (error) throw error;

    const map = new Map<string, any>();
    for (const row of (data || [])) {
      map.set(row.key, row.value);
    }

    return {
      sslWarnDays: Number(map.get('sslWarnDays')) || 30,
      responseTimeWarnMs: Number(map.get('responseTimeWarnMs')) || 3000,
      savedFilters: map.get('savedFilters') || []
    };
  }

  async write(settings: AppSettings): Promise<void> {
    const rows = [
      { key: 'sslWarnDays', value: settings.sslWarnDays },
      { key: 'responseTimeWarnMs', value: settings.responseTimeWarnMs },
      { key: 'savedFilters', value: settings.savedFilters }
    ];

    const { error } = await this.supabase
      .from('settings')
      .upsert(rows, { onConflict: 'key' });

    if (error) throw error;
  }
}
