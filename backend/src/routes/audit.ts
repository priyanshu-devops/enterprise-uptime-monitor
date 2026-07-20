/**
 * Audit log route — GET /api/v1/audit
 *
 * Returns paginated audit entries from the AuditLog sheet tab,
 * newest-first (the repository appends, so we reverse on read).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import type { ServiceContainer } from '../services/db.js';

function getService(req: Request): ServiceContainer {
  return req.app.locals.services as ServiceContainer;
}

const querySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(500).optional().default(50),
  actor: z.string().optional(),
  action: z.string().optional(),
  target: z.string().optional(),
});

export const auditRouter: import('express').Router = Router();

auditRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) throw ApiError.badRequest('Invalid query parameters');

    const { page, pageSize, actor, action, target } = parsed.data;

    let entries = await getService(req).provider.audit.readAll();

    // Newest first
    entries = entries.slice().reverse();

    // Optional filters
    if (actor) entries = entries.filter((e) => e.actor.toLowerCase().includes(actor.toLowerCase()));
    if (action) entries = entries.filter((e) => e.action.toUpperCase() === action.toUpperCase());
    if (target) entries = entries.filter((e) => e.target.toLowerCase().includes(target.toLowerCase()));

    const total = entries.length;
    const start = (page - 1) * pageSize;
    const items = entries.slice(start, start + pageSize);

    res.json({ items, total, page, pageSize });
  }),
);
