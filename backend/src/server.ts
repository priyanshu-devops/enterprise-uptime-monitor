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

// CORS
const frontendOrigin = process.env.FRONTEND_ORIGIN || '*';
app.use(cors({
  origin: frontendOrigin === '*' ? true : frontendOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

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

// Incidents
app.use('/api/v1/monitoring/incidents', incidentsRouter);

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

const PORT = Number(process.env.PORT) || 8080;

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, 'Backend API started');
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down...');
  server.close(async () => {
    await sheetsService.flush();
    logger.info('Server closed');
    process.exit(0);
  });

  // Force close after 10s
  setTimeout(() => {
    logger.error('Forced shutdown');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app };