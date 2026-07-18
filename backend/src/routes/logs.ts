/**
 * Logs route — GET /api/v1/logs
 *
 * Query params:
 *   category   monitor | audit
 *   date       YYYY-MM-DD  (defaults to today IST)
 *
 * For "audit" category the route reads from the AuditLog sheet tab.
 * For "monitor" category the route fetches JSONL files from the
 * GitHub Pages storage repo under /logs/YYYY-MM/DD.jsonl.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import type { SheetsService } from '../services/sheets.js';

function getService(req: Request): SheetsService {
  return req.app.locals.sheetsService as SheetsService;
}

const querySchema = z.object({
  category: z.enum(['monitor', 'audit']).optional().default('monitor'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional().default(1000),
});

export const logsRouter: import('express').Router = Router();

logsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) throw ApiError.badRequest('Invalid query parameters');

    const { category, limit } = parsed.data;

    // Default date = today in IST (UTC+5:30)
    const date = parsed.data.date ?? todayIST();

    if (category === 'audit') {
      // Serve from the AuditLog sheet tab
      const entries = await getService(req).getAuditLog();
      const filtered = entries
        .filter((e) => e.timestamp.startsWith(date))
        .slice(-limit)
        .reverse();
      res.json(filtered);
      return;
    }

    // Monitor logs live in the Pages storage repo as JSONL files
    const pagesBase = process.env.PAGES_BASE_URL || '';
    if (!pagesBase) {
      res.json([]); // No storage configured — return empty
      return;
    }

    const [ym, day] = [date.slice(0, 7), date.slice(8, 10)];
    const url = `${pagesBase}/logs/${ym}/${day}.jsonl`;

    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) {
        if (r.status === 404) {
          res.json([]); // No logs for this date yet
          return;
        }
        throw ApiError.serviceUnavailable(`Storage fetch failed (${r.status})`);
      }

      const text = await r.text();
      const lines = text
        .split('\n')
        .filter(Boolean)
        .slice(-limit);

      const rows: unknown[] = [];
      for (const line of lines) {
        try {
          rows.push(JSON.parse(line));
        } catch {
          // Skip malformed lines
        }
      }

      res.json(rows.reverse());
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      // Network failure — return empty instead of 503 so the UI degrades gracefully
      res.json([]);
    }
  }),
);

/** Return today's date in YYYY-MM-DD format, adjusted for IST (UTC+5:30). */
function todayIST(): string {
  const now = new Date();
  // Shift by +5:30
  const ist = new Date(now.getTime() + 5.5 * 3600000);
  return ist.toISOString().slice(0, 10);
}
