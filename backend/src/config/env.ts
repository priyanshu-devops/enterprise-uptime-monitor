/**
 * Environment configuration — Zod-parsed and validated at boot.
 *
 * In MOCK_DATA / test mode the Google Sheets and GitHub credentials are
 * optional so the server can boot with in-memory fakes for local dev.
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
    JWT_SECRET: z.string().min(8),
    JWT_EXPIRES_IN: z.string().default('24h'),

    /** Comma-separated CORS allowlist; empty = allow all (dev). */
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
