/**
 * @uptime/backend — Express REST API for the website-monitoring platform.
 *
 * Endpoints:
 *   POST   /api/v1/auth/login           — JWT login
 *   GET    /api/v1/healthz              — health check (public)
 *   GET    /api/v1/domains              — list domains (paginated, filtered)
 *   POST   /api/v1/domains              — create domain
 *   PATCH  /api/v1/domains/:domain      — update domain (user-owned fields)
 *   DELETE /api/v1/domains/:domain      — delete domain
 *   POST   /api/v1/domains/bulk         — bulk operations (tag, categorize, pause, etc.)
 *   POST   /api/v1/import/preview       — preview CSV/Excel import
 *   POST   /api/v1/import/commit        — commit validated import
 *   GET    /api/v1/export               — export domains (CSV, XLSX, JSON, PDF, MD, HTML)
 *   POST   /api/v1/monitoring/trigger   — trigger a monitoring run via GitHub Actions
 *   GET    /api/v1/monitoring/status    — last run summary + cache info
 *   GET    /api/v1/analytics/kpis       — KPI snapshot
 *   GET    /api/v1/analytics/trends     — time-series history
 *   GET    /api/v1/analytics/distributions — distribution breakdowns
 *   GET    /api/v1/monitoring/incidents — incident log
 *   GET    /api/v1/audit                — audit log
 *   GET    /api/v1/settings             — get app settings
 *   PATCH  /api/v1/settings             — update app settings
 *   POST   /api/v1/sheets/resync        — force cache refresh
 */

import 'node:process';

// Must be the FIRST local import: loads the repo `.env` into process.env
// before any other module evaluates. (ESM evaluates imported modules in order,
// before the importing module's body runs.)
import './bootstrap-env.js';

// Second: validate every env var via Zod. Throws with a readable report if
// anything is missing or malformed. Prevents booting with a weak JWT secret,
// a stub service-account, or an unset FRONTEND_ORIGIN in production. (C-1)
import { env, corsAllowlist, isProduction } from './config/runtime-env.js';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import pinoHttp from 'pino-http';

import { authRouter } from './routes/auth.js';
import { domainsRouter } from './routes/domains.js';
import { importRouter } from './routes/import.js';
import { exportRouter } from './routes/export.js';
import { monitoringRouter } from './routes/monitoring.js';
import { analyticsRouter } from './routes/analytics.js';
import { incidentsRouter } from './routes/incidents.js';
import { auditRouter } from './routes/audit.js';
import { settingsRouter } from './routes/settings.js';
import { sheetsRouter } from './routes/sheets.js';
import { jobsRouter } from './routes/jobs.js';
import { reportsRouter } from './routes/reports.js';
import { logsRouter } from './routes/logs.js';
import { publicRouter } from './routes/public.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authMiddleware } from './middleware/auth.js';
import { cacheMiddleware } from './middleware/cache.js';
import { createSheetsClient } from './services/sheets.js';
import type { SheetsService } from './services/sheets.js';
import type { CacheService } from './services/cache.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const app: import('express').Express = express();

// Trust proxy for Render (needed for rate limiting behind proxy)
app.set('trust proxy', 1);

// Request logging
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((pinoHttp as any)({ logger }));

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

// CORS — strict allowlist. Never reflects an arbitrary Origin with credentials.
// In production, `runtime-env.ts` refuses to boot if FRONTEND_ORIGIN is empty
// or "*", so `corsAllowlist` is guaranteed non-empty here.       (audit item C-3)
//
// In dev/mock, an empty allowlist falls back to `origin: true` (reflect) but
// with `credentials: false` — safe because there is no auth cookie/session to
// steal, and the JWT bearer scheme is not affected by CORS credentials.
const corsHasAllowlist = corsAllowlist.length > 0;
app.use(
  cors({
    origin: (origin, callback) => {
      // Same-origin, curl, health probes: no Origin header — always allow.
      if (!origin) return callback(null, true);

      if (!corsHasAllowlist) {
        // Dev-only convenience: reflect any origin (see credentials note below).
        return callback(null, true);
      }

      if (corsAllowlist.includes(origin)) {
        return callback(null, true);
      }

      logger.warn({ origin }, 'CORS rejected — origin not in allowlist');
      return callback(new Error('Origin not allowed by CORS policy'));
    },
    // Credentials are only enabled when we have a concrete allowlist. In dev
    // (no allowlist) we intentionally disable credentials to avoid the
    // Origin-reflection + credentials footgun (CVE-class CSRF hole).
    credentials: corsHasAllowlist,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Global rate limiter (excludes health check)
const globalLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 300, // 300 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
  skip: (req) => req.path === '/api/v1/healthz',
});
app.use(globalLimiter);

// Initialize services
const sheetsService: SheetsService = createSheetsClient();
const cacheService: CacheService = sheetsService.getCacheService();

// Make services available to routes
app.locals.sheetsService = sheetsService;
app.locals.cacheService = cacheService;

// Health check (public, no auth)
app.get('/api/v1/healthz', async (_req, res) => {
  try {
    const { reachable: sheetsReachable, cacheAgeSeconds } = await sheetsService.healthCheck();
    const response = {
      status: sheetsReachable ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      version: process.env.npm_package_version || '1.0.0',
      sheets: { reachable: sheetsReachable, cacheAgeSeconds },
      timestamp: new Date().toISOString(),
    };
    res.status(sheetsReachable ? 200 : 503).json(response);
  } catch {
    res.status(503).json({
      status: 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      version: process.env.npm_package_version || '1.0.0',
      sheets: { reachable: false, cacheAgeSeconds: null },
      timestamp: new Date().toISOString(),
    });
  }
});

// Auth routes (public)
app.use('/api/v1/auth', authRouter);

// Public status page data (no auth)
app.use('/api/v1/public', publicRouter);

// Protected routes (require JWT auth)
app.use('/api/v1', authMiddleware);

// Domain CRUD
app.use('/api/v1/domains', domainsRouter);

// Import/Export
app.use('/api/v1/import', importRouter);
app.use('/api/v1/export', exportRouter);

// Monitoring
app.use('/api/v1/monitoring', monitoringRouter);
app.use('/api/v1/monitoring/incidents', incidentsRouter);

// Analytics
app.use('/api/v1/analytics', analyticsRouter);

// Audit log
app.use('/api/v1/audit', auditRouter);

// Settings
app.use('/api/v1/settings', settingsRouter);

// Sheets management
app.use('/api/v1/sheets', sheetsRouter);

// Jobs (GitHub Actions)
app.use('/api/v1/jobs', jobsRouter);

// Reports
app.use('/api/v1/reports', reportsRouter);

// Logs
app.use('/api/v1/logs', logsRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    status: 404,
    title: 'Not Found',
    detail: 'The requested endpoint does not exist.',
  });
});

// Global error handler
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 4000;

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, 'Backend API started');
});

// Graceful shutdown — flushes cache, closes HTTP listener, then exits.
// Exits with a non-zero code if any step throws or times out so that Render
// treats the pod as failed and does not report false-positive successful drains.
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 10_000;

const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down…');

  // Give in-flight requests up to SHUTDOWN_TIMEOUT_MS to complete.
  const forceTimer = setTimeout(() => {
    logger.error({ signal }, 'Forced shutdown after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  // Don't let this timer keep the process alive if server.close() finishes first.
  forceTimer.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await sheetsService.flush();
    clearTimeout(forceTimer);
    logger.info('Server closed cleanly');
    process.exit(0);
  } catch (err) {
    clearTimeout(forceTimer);
    logger.error({ err }, 'Shutdown error');
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Global safety nets — surface these instead of dying silently.  (audit C-7/C-8)
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
  // Do NOT exit here: a stray rejection in a request handler shouldn't crash
  // the whole server. The errorHandler middleware catches request-scoped
  // rejections; anything reaching here is a bug we want visible in logs.
});

process.on('uncaughtException', (err) => {
  // An uncaught exception leaves the process in an unknown state; log and exit
  // so the platform can restart us with a clean slate.
  logger.fatal({ err }, 'Uncaught exception — exiting');
  // Trigger a graceful shutdown attempt, but give it a much shorter window.
  shutdown('uncaughtException').catch(() => process.exit(1));
});

// Log the resolved runtime configuration once at boot (secrets redacted).
logger.info(
  {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    mock: env.MOCK_DATA === '1',
    corsAllowlistSize: corsAllowlist.length,
    isProduction,
  },
  'Backend runtime configuration loaded',
);

export { app };