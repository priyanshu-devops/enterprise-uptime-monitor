/**
 * Environment configuration — Zod-parsed and validated at boot.
 *
 * In MOCK_DATA / test mode the Google Sheets and GitHub credentials are
 * optional so the server can boot with in-memory fakes for local dev.
 *
 * Production hardening:
 *   - JWT_SECRET must be ≥ 32 characters outside dev/test/mock (audit item C-1)
 *   - Real credentials required when NODE_ENV=production and MOCK_DATA≠1
 *   - FRONTEND_ORIGIN must be a concrete allowlist in production (audit item C-3)
 */
import { z } from 'zod';

/** Schema for all environment variables the backend reads. */
const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    NODE_ENV: z.string().default('development'),
    LOG_LEVEL: z.string().default('info'),
    /** When "1", boot with in-memory fakes (no Google Sheet / GitHub needed). */
    MOCK_DATA: z.string().optional().default(''),

    ADMIN_EMAIL: z.string().email().max(254),
    /** bcrypt hash of the admin password. Optional in mock mode (a default is generated). */
    ADMIN_PASSWORD_HASH: z.string().optional().default(''),
    // Absolute floor of 8 (dev convenience); production is raised to 32 in superRefine.
    JWT_SECRET: z.string().min(8),
    JWT_EXPIRES_IN: z.string().default('24h'),

    /** Comma-separated CORS allowlist. Required in production (see C-3). */
    FRONTEND_ORIGIN: z.string().optional().default(''),

    GOOGLE_SERVICE_ACCOUNT_JSON_B64: z.string().optional().default(''),
    SHEET_ID: z.string().optional().default(''),

    GITHUB_TOKEN: z.string().optional().default(''),
    GITHUB_OWNER: z.string().optional().default(''),
    CODE_REPO: z.string().optional().default(''),
    STORAGE_REPO: z.string().optional().default(''),
    /** GitHub Pages base URL of the storage repo (no trailing slash). */
    PAGES_BASE_URL: z.string().optional().default(''),

    CACHE_TTL_SECONDS: z.coerce.number().int().min(5).max(86_400).default(300),
  })
  .superRefine((env, ctx) => {
    const mock = env.MOCK_DATA === '1' || env.NODE_ENV === 'test';
    const production = env.NODE_ENV === 'production';

    // In production, JWT_SECRET must be a proper 256-bit-equivalent key.
    if (production && env.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'Must be at least 32 characters in production (use a 256-bit random secret)',
      });
    }

    if (!mock) {
      if (!env.SHEET_ID) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SHEET_ID'], message: 'Required unless MOCK_DATA=1' });
      }
      if (!env.GOOGLE_SERVICE_ACCOUNT_JSON_B64) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GOOGLE_SERVICE_ACCOUNT_JSON_B64'],
          message: 'Required unless MOCK_DATA=1',
        });
      }
      if (!env.ADMIN_PASSWORD_HASH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ADMIN_PASSWORD_HASH'],
          message: 'Required unless MOCK_DATA=1',
        });
      }
    }

    // In production, refuse to boot without a concrete FRONTEND_ORIGIN allowlist.
    if (production && !env.FRONTEND_ORIGIN.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FRONTEND_ORIGIN'],
        message: 'Required in production — set to a comma-separated allowlist of frontend origins',
      });
    }

    // A literal "*" in production is unsafe when combined with credentials.
    if (production && env.FRONTEND_ORIGIN.trim() === '*') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FRONTEND_ORIGIN'],
        message: 'Cannot be "*" in production — provide explicit origins',
      });
    }
  });

/** Parsed environment type. */
export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate process.env. Throws with a readable message listing
 * every missing/invalid variable.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}

/** True when the process should run against in-memory fakes. */
export function isMockMode(env: Env): boolean {
  return env.MOCK_DATA === '1';
}

/** Parse the comma-separated FRONTEND_ORIGIN allowlist. */
export function parseOrigins(env: Env): string[] {
  return env.FRONTEND_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
