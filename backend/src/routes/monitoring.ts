/**
 * Monitoring routes.
 *
 * GET /status           — last run summary + data-source label
 * GET /incidents        — incident log
 * GET /history/:domain  — per-domain trend (from Pages cache)
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import { cacheMiddleware } from '../middleware/cache.js';
import type { ServiceContainer } from '../services/db.js';

function getService(req: Request): ServiceContainer {
  return req.app.locals.services as ServiceContainer;
}

export const monitoringRouter: import('express').Router = Router();

// ── GET /status ───────────────────────────────────────────────────────────────

monitoringRouter.get(
  '/status',
  cacheMiddleware('monitoring:status', 60),
  asyncHandler(async (req: Request, res: Response) => {
    const svc = getService(req);
    const pagesBase = process.env.PAGES_BASE_URL || '';

    // Try to fetch the last-run summary from the storage-repo Pages cache
    let lastRun = null;
    let dataSource: 'cache' = 'cache';
    let cacheGeneratedAt: string | null = null;

    if (pagesBase) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const r = await fetch(`${pagesBase}/cache/summary.json`, { signal: controller.signal });
        clearTimeout(timer);
        if (r.ok) {
          lastRun = await r.json();
          cacheGeneratedAt = (lastRun as Record<string, string>).finishedAt ?? null;
        }
      } catch {
        // Unavailable — return null lastRun
      }
    }

    res.json({ lastRun, dataSource, cacheGeneratedAt });
  }),
);

// ── GET /incidents ────────────────────────────────────────────────────────────

monitoringRouter.get(
  '/incidents',
  cacheMiddleware('monitoring:incidents', 120),
  asyncHandler(async (req: Request, res: Response) => {
    const incidents = await getService(req).provider.incidents.readAll();
    res.json({ incidents });
  }),
);

// ── GET /history/:domain ──────────────────────────────────────────────────────

const historyQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(30),
});

monitoringRouter.get(
  '/history/:domain',
  asyncHandler(async (req: Request, res: Response) => {
    const domain = decodeURIComponent(req.params.domain!);
    const parsed = historyQuerySchema.safeParse(req.query);
    if (!parsed.success) throw ApiError.badRequest('Invalid query parameters');

    const pagesBase = process.env.PAGES_BASE_URL || '';
    const days = parsed.data.days;
    const points: unknown[] = [];

    if (pagesBase) {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');

      const fetchPromises = Array.from({ length: days }, (_, i) => {
        const d = new Date(now.getTime() - i * 86400000);
        const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        const day = pad(d.getDate());
        const url = `${pagesBase}/cache/history/${ym}/${day}.json`;

        return fetch(url, { signal: AbortSignal.timeout(5000) })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
      });

      const results = await Promise.all(fetchPromises);
      for (const result of results) {
        if (result && typeof result === 'object' && !Array.isArray(result)) {
          // Filter to just this domain if the daily file contains per-domain data
          const dayData = result as Record<string, unknown>;
          if (domain in dayData) {
            points.push(dayData[domain]);
          } else {
            // File may be the global summary — push as-is
            points.push(result);
          }
        }
      }
    }

    res.json({ domain, points: points.reverse() });
  }),
);
