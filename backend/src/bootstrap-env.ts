/**
 * Environment bootstrap — imported first by server.ts so the repo `.env` is
 * loaded before any other module evaluates or reads `process.env`.
 *
 * In production (Render) the variables are injected ambiently, so a missing
 * file is expected and silently ignored. Tries `backend/.env` first, then the
 * monorepo-root `.env`.
 */
import 'node:process';

for (const rel of ['../.env', '../../.env']) {
  try {
    process.loadEnvFile(new URL(rel, import.meta.url));
    break;
  } catch {
    // file absent — fall through to the next candidate / ambient env
  }
}
