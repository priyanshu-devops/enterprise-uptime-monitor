/**
 * Copy non-TS runtime assets into dist/ after tsc.
 *
 * tsc only emits .js/.d.ts, so JSON fingerprint tables that the engine loads at
 * runtime (via createRequire) must be copied alongside the compiled output.
 * Cross-platform (runs on Windows locally and Ubuntu in CI).
 */
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** [source, destination] pairs relative to the monitor package root. */
const assets = [
  ['src/checks/tech-rules/rules.json', 'dist/checks/tech-rules/rules.json'],
];

for (const [from, to] of assets) {
  const dest = join(root, to);
  await mkdir(dirname(dest), { recursive: true });
  await cp(join(root, from), dest);
  process.stdout.write(`copied ${from} -> ${to}\n`);
}
