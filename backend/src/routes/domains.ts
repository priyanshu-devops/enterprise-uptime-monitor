/**
 * Domain routes — full CRUD + bulk operations.
 *
 * GET    /                  list (paginated, filtered)
 * GET    /:domain           one domain by normalized key
 * POST   /                  create
 * PATCH  /:domain           update user-owned fields
 * DELETE /:domain           delete single domain
 * POST   /bulk              bulk action (delete|tag|untag|categorize|pause|resume)
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import { cacheMiddleware } from '../middleware/cache.js';
import type { SheetsService } from '../services/sheets.js';
import type { AuthRequest } from '../middleware/auth.js';

// ── Zod schemas ──────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  tag: z.string().optional(),
  company: z.string().optional(),
  project: z.string().optional(),
  owner: z.string().optional(),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(1000).optional(),
});

const createDomainSchema = z.object({
  website: z.string().min(1),
  company: z.string().optional().default(''),
  project: z.string().optional().default(''),
  owner: z.string().optional().default(''),
  department: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  tags: z.string().optional().default(''),
  category: z.string().optional().default(''),
});

const updateDomainSchema = createDomainSchema.partial();

const bulkSchema = z.object({
  action: z.enum(['delete', 'tag', 'untag', 'categorize', 'pause', 'resume']),
  domains: z.array(z.string()).min(1).max(500),
  value: z.string().optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getService(req: Request): SheetsService {
  return req.app.locals.sheetsService as SheetsService;
}

function actor(req: AuthRequest): string {
  return req.user?.email || 'api';
}

export const domainsRouter: import('express').Router = Router();

// ── GET / — list ──────────────────────────────────────────────────────────────

domainsRouter.get(
  '/',
  cacheMiddleware('domains'),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw ApiError.badRequest('Invalid query parameters');

    const svc = getService(req);
    const result = await svc.getDomains(parsed.data as Parameters<typeof svc.getDomains>[0]);

    res.json({
      items: result.items.map((r) => r.record),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  }),
);

// ── GET /:domain — single ─────────────────────────────────────────────────────

domainsRouter.get(
  '/:domain',
  cacheMiddleware('domain'),
  asyncHandler(async (req: Request, res: Response) => {
    const domain = decodeURIComponent(req.params.domain!);
    const row = await getService(req).getDomain(domain);
    if (!row) throw ApiError.notFound(`Domain not found: ${domain}`);
    res.json(row.record);
  }),
);

// ── POST / — create ───────────────────────────────────────────────────────────

domainsRouter.post(
  '/',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = createDomainSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Validation failed', formatZodErrors(parsed.error));

    try {
      const row = await getService(req).createDomain(
        parsed.data,
        actor(req),
        req.ip || '',
        req.headers['user-agent'] || '',
      );
      res.status(201).json(row.record);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already exists')) throw ApiError.conflict(msg);
      if (msg.includes('Invalid website')) throw ApiError.badRequest(msg);
      throw err;
    }
  }),
);

// ── PATCH /:domain — update ───────────────────────────────────────────────────

domainsRouter.patch(
  '/:domain',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const domain = decodeURIComponent(req.params.domain!);
    const parsed = updateDomainSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Validation failed', formatZodErrors(parsed.error));

    try {
      const row = await getService(req).updateDomain(
        domain,
        parsed.data,
        actor(req),
        req.ip || '',
        req.headers['user-agent'] || '',
      );
      res.json(row.record);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) throw ApiError.notFound(msg);
      if (msg.includes('already exists')) throw ApiError.conflict(msg);
      if (msg.includes('Invalid website')) throw ApiError.badRequest(msg);
      throw err;
    }
  }),
);

// ── DELETE /:domain — delete ──────────────────────────────────────────────────

domainsRouter.delete(
  '/:domain',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const domain = decodeURIComponent(req.params.domain!);
    const deleted = await getService(req).deleteDomains(
      [domain],
      actor(req),
      req.ip || '',
      req.headers['user-agent'] || '',
    );
    if (!deleted) throw ApiError.notFound(`Domain not found: ${domain}`);
    res.status(204).end();
  }),
);

// ── POST /bulk — bulk operation ───────────────────────────────────────────────

domainsRouter.post(
  '/bulk',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Validation failed', formatZodErrors(parsed.error));

    const { action, domains, value } = parsed.data;

    if (action === 'delete') {
      const count = await getService(req).deleteDomains(
        domains,
        actor(req),
        req.ip || '',
        req.headers['user-agent'] || '',
      );
      res.json({ deleted: count });
      return;
    }

    const count = await getService(req).bulkDomains(
      action as 'tag' | 'untag' | 'categorize' | 'pause' | 'resume',
      domains,
      value,
      actor(req),
      req.ip || '',
      req.headers['user-agent'] || '',
    );
    res.json({ updated: count });
  }),
);

// ── Utility ───────────────────────────────────────────────────────────────────

function formatZodErrors(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
