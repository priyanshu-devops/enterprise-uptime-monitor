/**
 * Sheets management routes.
 *
 * GET  /meta    — row count, cache age, last sync timestamp
 * POST /resync  — force a full cache invalidation + re-read
 */
import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { ServiceContainer } from '../services/db.js';
import type { CacheService } from '../services/cache.js';

function getService(req: Request): ServiceContainer {
  return req.app.locals.services as ServiceContainer;
}

function getCache(req: Request): CacheService {
  return req.app.locals.cacheService as CacheService;
}

export const sheetsRouter: import('express').Router = Router();

/** GET /meta — sheet connectivity + cache status. */
sheetsRouter.get(
  '/meta',
  asyncHandler(async (req: Request, res: Response) => {
    const svc = getService(req);
    const cache = getCache(req);

    const { reachable, cacheAgeSeconds } = await svc.healthCheck();
    const cacheInfo = cache.getCacheInfo();
    const stats = cache.getStats();

    // Try to get row count from cached domains
    let rowCount: number | null = null;
    try {
      const domains = await svc.domains.readAllDomains();
      rowCount = domains.length;
    } catch {
      rowCount = null;
    }

    res.json({
      reachable,
      rowCount,
      cacheAgeSeconds,
      cacheSize: stats.size,
      lastSync: cacheInfo ? new Date(cacheInfo.generatedAt).toISOString() : null,
    });
  }),
);

/** POST /resync — invalidate all cache keys and trigger a fresh read. */
sheetsRouter.post(
  '/resync',
  asyncHandler(async (req: Request, res: Response) => {
    const svc = getService(req);
    const cache = getCache(req);

    // Invalidate everything
    cache.invalidatePrefix('');

    // Eagerly re-read domains to warm the cache
    let rowCount = 0;
    try {
      const domains = await svc.domains.readAllDomains(true);
      rowCount = domains.length;
    } catch {
      // Non-fatal — cache is cleared, next request will re-hydrate
    }

    res.json({
      ok: true,
      message: 'Cache cleared and re-populated',
      rowCount,
      syncedAt: new Date().toISOString(),
    });
  }),
);
