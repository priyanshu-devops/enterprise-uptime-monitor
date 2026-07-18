/**
 * Local development loop: run the monitor engine against a handful of domains
 * without touching any Google Sheet.
 *
 * Usage:
 *   pnpm local-run                       # 10 fixture domains, no screenshots
 *   pnpm local-run -- --screenshots      # include screenshots
 *   pnpm local-run -- --domains a.com,b.com
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalizeDomain } from '@uptime/shared';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const withScreenshots = args.includes('--screenshots');
const domainsFlagIdx = args.indexOf('--domains');

let domains: string;
if (domainsFlagIdx !== -1 && args[domainsFlagIdx + 1]) {
  domains = args[domainsFlagIdx + 1]!;
} else {
  const csv = readFileSync(join(root, 'fixtures', 'domains-10.csv'), 'utf8');
  domains = csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => normalizeDomain(line.split(',')[4] ?? '').domain)
    .filter(Boolean)
    .join(',');
}

console.log(`Running monitor locally for: ${domains}\n`);

const result = spawnSync(
  process.execPath,
  [
    join(root, 'monitor', 'dist', 'index.js'),
    '--dry-run',
    '--domains',
    domains,
    '--output',
    join(root, 'monitor', 'output'),
    ...(withScreenshots ? [] : ['--skip-screenshots']),
  ],
  { stdio: 'inherit', env: process.env },
);

process.exit(result.status ?? 1);
