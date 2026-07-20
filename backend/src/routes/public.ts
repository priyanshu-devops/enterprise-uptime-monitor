/**
 * Public routes — no authentication.
 *
 * GET /status — data for the public status page: run summary, fleet SLA,
 * per-domain status + 30d uptime, and open incidents. Served from the GitHub
 * Pages cache when configured (fast, no quota), otherwise assembled live from
 * the sheet. Only status-page-safe fields are exposed (no owner/notes/etc.).
 */
import { Router, type Request, type Response } from 'express';
import type { Incident, SlaReport } from '@uptime/shared';
import { asyncHandler } from '../middleware/errorHandler.js';
import { cacheMiddleware } from '../middleware/cache.js';
import type { SheetsService } from '../services/sheets.js';

function getService(req: Request): SheetsService {
  return req.app.locals.sheetsService as SheetsService;
}

/** Fetch JSON from the Pages cache with a short timeout; null on any failure. */
async function pagesJson<T>(pagesBase: string, file: string): Promise<T | null> {
  try {
    const r = await fetch(`${pagesBase}/cache/${file}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export const publicRouter: import('express').Router = Router();

publicRouter.get(
  '/status',
  cacheMiddleware('public:status', 60),
  asyncHandler(async (req: Request, res: Response) => {
    const pagesBase = (process.env.PAGES_BASE_URL || '').replace(/\/+$/, '');

    let sla: SlaReport | null = null;
    let incidents: Incident[] = [];
    let summary: Record<string, unknown> | null = null;

    if (pagesBase) {
      [sla, summary] = await Promise.all([
        pagesJson<SlaReport>(pagesBase, 'sla.json'),
        pagesJson<Record<string, unknown>>(pagesBase, 'summary.json'),
      ]);
      incidents = (await pagesJson<Incident[]>(pagesBase, 'incidents.json')) ?? [];
    }

    // Live fallback when the Pages cache is unavailable.
    if (incidents.length === 0 && !summary) {
      incidents = await getService(req).getIncidents().catch(() => []);
    }

    const openIncidents = incidents
      .filter((i) => i.status === 'open')
      .map((i) => ({
        id: i.id,
        domain: i.domain,
        type: i.type,
        openedAt: i.openedAt,
        message: i.message,
      }));

    const domains = (sla?.domains ?? []).map((d) => ({
      domain: d.domain,
      status: d.status,
      uptime30d: d.uptime['30d'],
      p95Ms: d.p95Ms,
    }));

    res.json({
      generatedAt: sla?.generatedAt ?? null,
      fleet: sla
        ? {
            uptime: sla.fleet,
            p50Ms: sla.fleetP50Ms,
            p95Ms: sla.fleetP95Ms,
            p99Ms: sla.fleetP99Ms,
            mttrSeconds30d: sla.mttrSeconds30d,
          }
        : null,
      summary: summary
        ? {
            totalDomains: summary['totalDomains'] ?? null,
            up: summary['up'] ?? null,
            down: summary['down'] ?? null,
            degraded: summary['degraded'] ?? null,
            finishedAt: summary['finishedAt'] ?? null,
          }
        : null,
      domains,
      openIncidents,
    });
  }),
);
