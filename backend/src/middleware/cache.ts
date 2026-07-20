/**
 * Server-side cache middleware (5-minute TTL by default).
 * Caches GET responses from Sheets-backed endpoints.
 */
import { Request, Response, NextFunction } from 'express';
import pino from 'pino';

import { CacheService } from '../services/cache.js';

const logger = pino({ name: 'cache-middleware' });

/**
 * Cache middleware factory.
 * @param keyPrefix - Prefix for cache key (e.g., 'domains', 'analytics')
 * @param ttlSeconds - Time to live in seconds (default from CACHE_TTL_SECONDS env or 300)
 */
export function cacheMiddleware(
  keyPrefix: string,
  ttlSeconds = Number(process.env.CACHE_TTL_SECONDS) || 300,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Skip if user requested no-cache
    if (req.headers['cache-control'] === 'no-cache' || req.headers.pragma === 'no-cache') {
      return next();
    }

    const cacheService = req.app.locals.cacheService as CacheService;
    if (!cacheService) {
      logger.warn('Cache service not initialized');
      return next();
    }

    // Build cache key from path + query
    const queryString = Object.keys(req.query).length
      ? '?' + new URLSearchParams(req.query as Record<string, string>).toString()
      : '';
    const cacheKey = `${keyPrefix}:${req.path}${queryString}`;

    const cached = cacheService.get(cacheKey);
    if (cached) {
      logger.debug({ key: cacheKey }, 'Cache hit');
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Cache-Age', String(Math.floor((Date.now() - cached.timestamp) / 1000)));
      res.json(cached.data);
      return;
    }

    logger.debug({ key: cacheKey }, 'Cache miss');
    res.setHeader('X-Cache', 'MISS');

    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      // Only cache successful responses that have a body
      if (res.statusCode >= 200 && res.statusCode < 300 && body !== undefined && body !== null) {
        cacheService.set(cacheKey, body, ttlSeconds);
      }
      return originalJson(body);
    };

    next();
  };
}

/**
 * Invalidate cache entries by prefix.
 */
export function invalidateCacheMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    // After successful mutations, we could invalidate related caches
    // For now, just pass through
    return originalJson(body);
  };
  next();
}