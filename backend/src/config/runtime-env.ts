/**
 * Runtime env singleton — runs `loadEnv()` exactly once during boot.
 *
 * Import this module BEFORE any other module reads `process.env`. Doing so
 * guarantees that a misconfigured deployment fails fast with a readable Zod
 * report (audit item C-1) instead of booting with silently-broken defaults.
 *
 * Consumers can either:
 *   - `import { env } from './config/runtime-env.js'` for the typed record, or
 *   - continue reading `process.env` directly (unchanged: this module does not
 *     mutate process.env).
 */
import { loadEnv, isMockMode, parseOrigins, type Env } from './env.js';

/** The parsed, validated environment. Frozen — do not mutate. */
export const env: Readonly<Env> = Object.freeze(loadEnv());

/** True when the process should run against in-memory fakes. */
export const isMock: boolean = isMockMode(env);

/** CORS allowlist parsed from `FRONTEND_ORIGIN`. Empty array = no explicit list. */
export const corsAllowlist: readonly string[] = Object.freeze(parseOrigins(env));

/** True when NODE_ENV === 'production'. */
export const isProduction: boolean = env.NODE_ENV === 'production';
