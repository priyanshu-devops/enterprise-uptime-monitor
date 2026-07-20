/**
 * Incidents route — GET /api/v1/monitoring/incidents
 *
 * This router is mounted BOTH at /api/v1/monitoring/incidents (via
 * server.ts direct mount) and is also delegated to from monitoringRouter.
 * Keeping it as a standalone router avoids circular coupling.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import { cacheMiddleware } from '../middleware/cache.js';
import type { AuthRequest } from '../middleware/auth.js';
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

// ── PATCH /:id — acknowledge or manually resolve ──────────────────────────────

const actionSchema = z.object({ action: z.enum(['ack', 'resolve']) });

incidentsRouter.patch(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = actionSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Invalid action — expected "ack" or "resolve"');

    const actor = (req as AuthRequest).user?.email ?? 'dashboard';
    const updated = await getService(req).updateIncident(
      req.params.id!,
      parsed.data.action,
      actor,
    );
    if (!updated) throw ApiError.notFound(`Incident not found: ${req.params.id}`);
    res.json(updated);
  }),
);
