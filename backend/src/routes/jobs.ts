/**
 * Jobs routes — GitHub Actions workflow management.
 *
 * POST /trigger   — dispatch monitor.yml workflow_dispatch
 * GET  /          — list recent workflow runs
 * GET  /:id       — one workflow run
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import type { JobRun } from '@uptime/shared';

const GITHUB_API = 'https://api.github.com';

const triggerSchema = z.object({
  domains: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  skipScreenshots: z.boolean().optional(),
});

/** Build GitHub API request headers. */
function ghHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw ApiError.serviceUnavailable('GITHUB_TOKEN not configured');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

function getRepoCoords(): { owner: string; repo: string } {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.CODE_REPO;
  if (!owner || !repo) throw ApiError.serviceUnavailable('GitHub repo not configured');
  return { owner, repo };
}

/** Convert a GitHub API run object to our JobRun shape. */
function toJobRun(run: Record<string, unknown>): JobRun {
  const createdAt = String(run['created_at'] ?? '');
  const updatedAt = String(run['updated_at'] ?? '');
  const durationMs =
    createdAt && updatedAt
      ? new Date(updatedAt).getTime() - new Date(createdAt).getTime()
      : null;

  return {
    id: Number(run['id']),
    name: String(run['name'] ?? run['display_title'] ?? ''),
    status: (run['status'] as JobRun['status']) ?? 'completed',
    conclusion: run['conclusion'] ? String(run['conclusion']) : null,
    event: String(run['event'] ?? ''),
    createdAt,
    updatedAt,
    htmlUrl: String(run['html_url'] ?? ''),
    durationSeconds: durationMs !== null ? Math.round(durationMs / 1000) : null,
  };
}

export const jobsRouter: import('express').Router = Router();

// ── POST /trigger ─────────────────────────────────────────────────────────────

jobsRouter.post(
  '/trigger',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = triggerSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Invalid trigger payload');

    if (process.env.MOCK_DATA === '1') {
      res.json({ ok: true, message: 'Mock mode — workflow not actually triggered' });
      return;
    }

    const { owner, repo } = getRepoCoords();
    const { domains, limit, skipScreenshots } = parsed.data;

    const inputs: Record<string, string> = {};
    if (domains?.length) inputs['domains'] = domains.join(',');
    if (limit) inputs['limit'] = String(limit);
    if (skipScreenshots) inputs['skip_screenshots'] = 'true';

    const r = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/monitor.yml/dispatches`,
      {
        method: 'POST',
        headers: ghHeaders(),
        body: JSON.stringify({ ref: 'main', inputs }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!r.ok) {
      const body = await r.text();
      throw ApiError.serviceUnavailable(`GitHub API error (${r.status}): ${body}`);
    }

    res.json({ ok: true, message: 'Monitoring run triggered via GitHub Actions' });
  }),
);

// ── GET / — list runs ─────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  per_page: z.coerce.number().int().min(1).max(100).optional().default(20),
  page: z.coerce.number().int().min(1).optional().default(1),
});

jobsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    if (process.env.MOCK_DATA === '1') {
      res.json(mockRuns());
      return;
    }

    const parsed = listQuerySchema.safeParse(req.query);
    const { per_page, page } = parsed.success ? parsed.data : { per_page: 20, page: 1 };
    const { owner, repo } = getRepoCoords();

    const r = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/monitor.yml/runs?per_page=${per_page}&page=${page}`,
      { headers: ghHeaders(), signal: AbortSignal.timeout(15000) },
    );

    if (!r.ok) throw ApiError.serviceUnavailable(`GitHub API error (${r.status})`);

    const data = (await r.json()) as { workflow_runs: Record<string, unknown>[] };
    res.json((data.workflow_runs ?? []).map(toJobRun));
  }),
);

// ── GET /:id — one run ────────────────────────────────────────────────────────

jobsRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id!, 10);
    if (isNaN(id)) throw ApiError.badRequest('Invalid run ID');

    if (process.env.MOCK_DATA === '1') {
      const runs = mockRuns();
      const run = runs.find((r) => r.id === id);
      if (!run) throw ApiError.notFound(`Run not found: ${id}`);
      res.json(run);
      return;
    }

    const { owner, repo } = getRepoCoords();
    const r = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/actions/runs/${id}`,
      { headers: ghHeaders(), signal: AbortSignal.timeout(15000) },
    );

    if (r.status === 404) throw ApiError.notFound(`Run not found: ${id}`);
    if (!r.ok) throw ApiError.serviceUnavailable(`GitHub API error (${r.status})`);

    const run = (await r.json()) as Record<string, unknown>;
    res.json(toJobRun(run));
  }),
);

// ── Mock data ─────────────────────────────────────────────────────────────────

function mockRuns(): JobRun[] {
  const now = new Date();
  return [
    {
      id: 1001,
      name: 'Monitor — full run',
      status: 'completed',
      conclusion: 'success',
      event: 'schedule',
      createdAt: new Date(now.getTime() - 3600000).toISOString(),
      updatedAt: new Date(now.getTime() - 2400000).toISOString(),
      htmlUrl: 'https://github.com',
      durationSeconds: 1200,
    },
    {
      id: 1000,
      name: 'Monitor — full run',
      status: 'completed',
      conclusion: 'success',
      event: 'schedule',
      createdAt: new Date(now.getTime() - 90000000).toISOString(),
      updatedAt: new Date(now.getTime() - 88800000).toISOString(),
      htmlUrl: 'https://github.com',
      durationSeconds: 1140,
    },
  ];
}
