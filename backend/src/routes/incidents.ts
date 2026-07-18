/**
 * Incidents route — GET /api/v1/monitoring/incidents
 *
 * This router is mounted BOTH at /api/v1/monitoring/incidents (via
 * server.ts direct mount) and is also delegated to from monitoringRouter.
 * Keeping it as a standalone router avoids circular coupling.
 */
import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { cacheMiddleware } from '../middleware/cache.js';
import type { SheetsService } from '../services/sheets.js';

function getService(req: Request): SheetsService {
  return req.app.locals.sheetsService as SheetsService;
}

export const incidentsRouter: import('express').Router = Router();

/** GET / — full incident log. */
incidentsRouter.get(
  '/',
  cacheMiddleware('incidents', 120),
  asyncHandler(async (req: Request, res: Response) => {
    const incidents = await getService(req).getIncidents();
    res.json({ incidents });
  }),
);
