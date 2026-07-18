/**
 * Structured JSONL logging for the monitor engine.
 *
 * Every log line is a single JSON object written to stderr (so stdout stays
 * clean for `--plan` JSON output), and simultaneously buffered so the run can
 * be committed as `logs/monitor/<date>.jsonl` in the storage repo.
 *
 * Deliberately dependency-free (no pino) to keep the Actions install lean and
 * avoid ESM/CJS interop friction.
 */

/** Log severity levels. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** One structured log record. */
export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * A logger that writes JSONL to stderr and retains records in memory for
 * later persistence to the storage repo.
 */
export class Logger {
  private readonly records: LogRecord[] = [];
  private readonly minLevel: number;

  constructor(
    private readonly context: Record<string, unknown> = {},
    minLevel: LogLevel = 'info',
  ) {
    this.minLevel = LEVEL_ORDER[minLevel];
  }

  /** Create a child logger that inherits and extends context. */
  child(context: Record<string, unknown>): Logger {
    const child = new Logger({ ...this.context, ...context });
    // Share the same buffer so a single flush captures everything.
    (child as unknown as { records: LogRecord[] }).records = this.records;
    return child;
  }

  debug(message: string, fields: Record<string, unknown> = {}): void {
    this.write('debug', message, fields);
  }
  info(message: string, fields: Record<string, unknown> = {}): void {
    this.write('info', message, fields);
  }
  warn(message: string, fields: Record<string, unknown> = {}): void {
    this.write('warn', message, fields);
  }
  error(message: string, fields: Record<string, unknown> = {}): void {
    this.write('error', message, fields);
  }

  private write(level: LogLevel, message: string, fields: Record<string, unknown>): void {
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...fields,
    };
    this.records.push(record);
    if (LEVEL_ORDER[level] >= this.minLevel) {
      process.stderr.write(`${JSON.stringify(record)}\n`);
    }
  }

  /** All buffered records (for persisting to the storage repo). */
  drain(): LogRecord[] {
    return this.records.slice();
  }

  /** Serialize buffered records as newline-delimited JSON. */
  toJsonl(): string {
    return this.records.map((r) => JSON.stringify(r)).join('\n') + (this.records.length ? '\n' : '');
  }
}

/** Normalize any thrown value into a short message string. */
export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
