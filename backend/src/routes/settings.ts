/**
 * Settings routes — GET /api/v1/settings, PUT /api/v1/settings
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import type { SheetsService } from '../services/sheets.js';

function getService(req: Request): SheetsService {
  return req.app.locals.sheetsService as SheetsService;
}

const savedFilterSchema = z.object({
  name: z.string().min(1),
  query: z.record(z.unknown()),
});

const settingsSchema = z.object({
  sslWarnDays: z.number().int().min(1).max(365).optional(),
  responseTimeWarnMs: z.number().int().min(100).max(60000).optional(),
  savedFilters: z.array(savedFilterSchema).optional(),
});

export const settingsRouter: import('express').Router = Router();

/** GET / — read app settings. */
settingsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const settings = await getService(req).getSettings();
    res.json(settings);
  }),
);

/** PUT / — overwrite app settings (full replace). */
settingsRouter.put(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Invalid settings body');
    const updated = await getService(req).updateSettings(parsed.data);
    res.json(updated);
  }),
);

/** PATCH / — partial-update app settings. */
settingsRouter.patch(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = settingsSchema.partial().safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Invalid settings body');
    const updated = await getService(req).updateSettings(parsed.data);
    res.json(updated);
  }),
);
