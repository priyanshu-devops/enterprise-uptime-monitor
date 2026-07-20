/**
 * Analytics routes.
 *
 * GET /kpis            — KPI snapshot
 * GET /trends          — time-series history points
 * GET /distributions   — status/hosting/CDN/CMS/framework/SSL/health buckets
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import { cacheMiddleware } from '../middleware/cache.js';
import type { SheetsService } from '../services/sheets.js';

function getService(req: Request): SheetsService {
  return req.app.locals.sheetsService as SheetsService;
}

export const analyticsRouter: import('express').Router = Router();

// ── GET /kpis ─────────────────────────────────────────────────────────────────

analyticsRouter.get(
  '/kpis',
  cacheMiddleware('analytics:kpis', 120),
  asyncHandler(async (req: Request, res: Response) => {
    const kpis = await getService(req).getKpis();
    res.json(kpis);
  }),
);

// ── GET /trends ───────────────────────────────────────────────────────────────

const trendsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(30),
});

analyticsRouter.get(
  '/trends',
  cacheMiddleware('analytics:trends', 300),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = trendsQuerySchema.safeParse(req.query);
    const days = parsed.success ? parsed.data.days : 30;

    const pagesBase = process.env.PAGES_BASE_URL || '';
    const points: unknown[] = [];

    if (pagesBase) {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');

      const fetchPromises = Array.from({ length: days }, (_, i) => {
        const d = new Date(now.getTime() - i * 86400000);
        const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        const day = pad(d.getDate());
        return fetch(`${pagesBase}/cache/history/${ym}/${day}.json`, { signal: AbortSignal.timeout(5000) })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
      });

      const results = await Promise.all(fetchPromises);
      for (const r of results) {
        if (r !== null) points.push(r);
      }
    }

    // Fallback: derive trend from current snapshot if no Pages history
    if (points.length === 0) {
      const kpis = await getService(req).getKpis();
      points.push({
        date: new Date().toISOString().slice(0, 10),
        up: kpis.healthy,
        down: kpis.down,
        degraded: kpis.degraded,
        total: kpis.totalDomains,
        avgResponseTimeMs: kpis.avgResponseTimeMs,
        avgTtfbMs: kpis.avgTtfbMs,
        avgHealthScore: kpis.avgHealthScore,
        availabilityPct:
          kpis.totalDomains > 0
            ? Math.round((kpis.healthy / kpis.totalDomains) * 10000) / 100
            : 0,
      });
    }

    res.json({ points: points.reverse() });
  }),
);

// ── GET /sla ──────────────────────────────────────────────────────────────────

analyticsRouter.get(
  '/sla',
  cacheMiddleware('analytics:sla', 300),
  asyncHandler(async (_req: Request, res: Response) => {
    const pagesBase = process.env.PAGES_BASE_URL || '';
    if (pagesBase) {
      try {
        const r = await fetch(`${pagesBase}/cache/sla.json`, {
          signal: AbortSignal.timeout(5000),
        });
        if (r.ok) {
          res.json(await r.json());
          return;
        }
      } catch {
        // fall through to the empty response
      }
    }
    // No SLA data yet (first run pending) — the frontend hides the section.
    res.json(null);
  }),
);

// ── GET /distributions ────────────────────────────────────────────────────────

analyticsRouter.get(
  '/distributions',
  cacheMiddleware('analytics:distributions', 300),
  asyncHandler(async (req: Request, res: Response) => {
    const distributions = await getService(req).getDistributions();
    res.json(distributions);
  }),
);
