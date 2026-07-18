/**
 * Date helpers — the platform reports times in IST (Asia/Kolkata) because the
 * scheduler runs at 09:00/21:00 IST and the sheet audience is IST-based.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Current date/time shifted to IST. */
function toIst(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

/** Format a date as YYYY-MM-DD in IST. */
export function istDate(date: Date = new Date()): string {
  return toIst(date).toISOString().slice(0, 10);
}

/** Format a time as HH:mm:ss in IST. */
export function istTime(date: Date = new Date()): string {
  return toIst(date).toISOString().slice(11, 19);
}

/** ISO timestamp (UTC) — used for machine-readable fields. */
export function isoNow(date: Date = new Date()): string {
  return date.toISOString();
}

/** Format an ISO date string to YYYY-MM-DD, or '' when absent/invalid. */
export function toDateOnly(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toISOString().slice(0, 10);
}

/** Milliseconds to a human string like "1.24s" or "820ms". */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

/** Bytes to KB string with one decimal. */
export function bytesToKb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  return `${(bytes / 1024).toFixed(1)} KB`;
}
