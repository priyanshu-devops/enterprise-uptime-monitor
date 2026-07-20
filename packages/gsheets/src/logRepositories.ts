/**
 * Append-only repositories for the AuditLog, IncidentLog, and ImportHistory
 * tabs, plus Settings read/write.
 */
import {
  SHEET_TABS,
  sanitizeSheetRow,
  type AppSettings,
  type AuditEntry,
  type Incident,
} from '@uptime/shared';
import type { SheetsClient } from './client.js';

/** Buffered audit writer — flushes every N events or T ms to respect quotas. */
export class AuditLogRepository {
  private buffer: unknown[][] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly client: SheetsClient,
    private readonly flushEvery = 10,
    private readonly flushMs = 30_000,
  ) {}

  /** Queue an audit entry; flushes automatically. */
  record(entry: AuditEntry): void {
    // Audit rows carry attacker-influencable text (actor, target, userAgent,
    // before/after). None is ever a formula, so sanitize the whole row. (C-4)
    this.buffer.push(
      sanitizeSheetRow([
        entry.timestamp,
        entry.actor,
        entry.action,
        entry.target,
        entry.ip,
        entry.userAgent,
        entry.status,
        entry.before,
        entry.after,
        entry.reason,
      ]),
    );
    if (this.buffer.length >= this.flushEvery) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.flushMs);
      // Don't hold the process open just for the audit buffer.
      if (typeof this.timer === 'object' && 'unref' in this.timer) this.timer.unref();
    }
  }

  /** Flush pending entries to the sheet. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return;
    const rows = this.buffer;
    this.buffer = [];
    try {
      await this.client.append(`${SHEET_TABS.auditLog}!A2:J`, rows);
    } catch (err) {
      // Re-queue on failure so events aren't lost silently.
      this.buffer = rows.concat(this.buffer);
      throw err;
    }
  }

  /** Read the newest audit entries (most recent last in the sheet). */
  async readAll(): Promise<AuditEntry[]> {
    const [rows] = await this.client.batchGet([`${SHEET_TABS.auditLog}!A2:J`]);
    return (rows ?? []).map((r) => ({
      timestamp: str(r[0]),
      actor: str(r[1]),
      action: str(r[2]),
      target: str(r[3]),
      ip: str(r[4]),
      userAgent: str(r[5]),
      status: (str(r[6]) as AuditEntry['status']) || 'success',
      before: str(r[7]),
      after: str(r[8]),
      reason: str(r[9]),
    }));
  }
}

/** IncidentLog tab repository. */
export class IncidentLogRepository {
  constructor(private readonly client: SheetsClient) {}

  async append(incidents: Incident[]): Promise<void> {
    if (incidents.length === 0) return;
    await this.client.append(
      `${SHEET_TABS.incidentLog}!A2:L`,
      incidents.map((i) => toRow(i)),
    );
  }

  async readAll(): Promise<Incident[]> {
    const [rows] = await this.client.batchGet([`${SHEET_TABS.incidentLog}!A2:L`]);
    return (rows ?? []).map((r) => fromRow(r));
  }

  /**
   * Overwrite specific incidents in place, matched by id.
   * Reads the id column to locate rows; unknown ids are skipped.
   *
   * @returns Number of rows actually updated.
   */
  async update(incidents: Incident[]): Promise<number> {
    if (incidents.length === 0) return 0;
    const [idRows] = await this.client.batchGet([`${SHEET_TABS.incidentLog}!A2:A`]);
    const rowById = new Map<string, number>();
    (idRows ?? []).forEach((r, i) => {
      const id = str(r[0]);
      if (id) rowById.set(id, i + 2); // sheet rows are 1-based; +1 for header
    });
    const updates: { range: string; values: unknown[][] }[] = [];
    for (const inc of incidents) {
      const row = rowById.get(inc.id);
      if (row === undefined) continue;
      updates.push({ range: `${SHEET_TABS.incidentLog}!A${row}:L${row}`, values: [toRow(inc)] });
    }
    if (updates.length > 0) await this.client.batchUpdate(updates);
    return updates.length;
  }
}

/** Serialize an incident to its sheet row (columns A..L). */
function toRow(i: Incident): unknown[] {
  // `domain` and `message` are influenced by monitored content; neutralize the
  // whole row against formula injection (C-4).
  return sanitizeSheetRow([
    i.id,
    i.domain,
    i.type,
    i.status,
    i.openedAt,
    i.resolvedAt ?? '',
    i.fromStatus,
    i.toStatus,
    i.message,
    i.durationSeconds ?? '',
    i.ackedAt ?? '',
    i.ackedBy,
  ]);
}

/** Parse a sheet row (columns A..L) into an incident. */
function fromRow(r: unknown[]): Incident {
  const dur = Number(str(r[9]));
  return {
    id: str(r[0]),
    domain: str(r[1]),
    type: str(r[2]) as Incident['type'],
    status: (str(r[3]) as Incident['status']) || 'open',
    openedAt: str(r[4]),
    resolvedAt: str(r[5]) || null,
    fromStatus: str(r[6]),
    toStatus: str(r[7]),
    message: str(r[8]),
    durationSeconds: str(r[9]) !== '' && Number.isFinite(dur) ? dur : null,
    ackedAt: str(r[10]) || null,
    ackedBy: str(r[11]),
  };
}

/** ImportHistory tab repository. */
export class ImportHistoryRepository {
  constructor(private readonly client: SheetsClient) {}

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
    await this.client.append(`${SHEET_TABS.importHistory}!A2:J`, [
      sanitizeSheetRow([
        row.importId,
        row.importedAt,
        row.actor,
        row.source,
        row.total,
        row.accepted,
        row.duplicates,
        row.invalid,
        row.corrected,
        row.skipped,
      ]),
    ]);
  }

  async readAll(): Promise<Record<string, string>[]> {
    const [rows] = await this.client.batchGet([`${SHEET_TABS.importHistory}!A2:J`]);
    return (rows ?? []).map((r) => ({
      importId: str(r[0]),
      importedAt: str(r[1]),
      actor: str(r[2]),
      source: str(r[3]),
      total: str(r[4]),
      accepted: str(r[5]),
      duplicates: str(r[6]),
      invalid: str(r[7]),
      corrected: str(r[8]),
      skipped: str(r[9]),
    }));
  }
}

/** Settings tab (key/value pairs in A:B). */
export class SettingsRepository {
  constructor(private readonly client: SheetsClient) {}

  async read(): Promise<AppSettings> {
    const [rows] = await this.client.batchGet([`${SHEET_TABS.settings}!A2:B`]);
    const map = new Map<string, string>();
    for (const r of rows ?? []) map.set(str(r[0]), str(r[1]));
    let savedFilters: AppSettings['savedFilters'] = [];
    try {
      savedFilters = JSON.parse(map.get('savedFilters') || '[]') as AppSettings['savedFilters'];
    } catch {
      savedFilters = [];
    }
    return {
      sslWarnDays: toInt(map.get('sslWarnDays'), 30),
      responseTimeWarnMs: toInt(map.get('responseTimeWarnMs'), 3000),
      savedFilters,
    };
  }

  async write(settings: AppSettings): Promise<void> {
    await this.client.batchUpdate([
      {
        range: `${SHEET_TABS.settings}!A2:B4`,
        values: [
          ['sslWarnDays', String(settings.sslWarnDays)],
          ['responseTimeWarnMs', String(settings.responseTimeWarnMs)],
          ['savedFilters', JSON.stringify(settings.savedFilters)],
        ],
      },
    ]);
  }
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

function toInt(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
