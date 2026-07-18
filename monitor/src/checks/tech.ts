/**
 * Technology detection stage.
 *
 * Applies the curated `tech-rules/rules.json` fingerprints against the response
 * headers, cookies, and HTML body captured by the HTTP stage. No extra network
 * requests. Produces CMS, framework, CDN, and a deduped technology stack.
 */
import { createRequire } from 'node:module';
import type { HttpResult, TechResult } from '@uptime/shared';

const require = createRequire(import.meta.url);

/** One fingerprint rule. */
interface Rule {
  name: string;
  headers?: Record<string, string>;
  cookies?: string[];
  html?: string[];
  generator?: string[];
  wordpress?: boolean;
  cloudflare?: boolean;
}

/** The rules file shape. */
interface RulesFile {
  cms: Rule[];
  framework: Rule[];
  cdn: Rule[];
  server: Rule[];
  analytics: Rule[];
}

// Loaded once at module init; JSON is bundled next to the compiled output.
const RULES = require('./tech-rules/rules.json') as RulesFile;

/** Extract the generator meta tag content from an HTML body (cheap regex). */
function generatorMeta(body: string): string {
  const m = body.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i);
  return m?.[1] ?? '';
}

/** Test whether a single rule matches the given evidence. */
function ruleMatches(
  rule: Rule,
  headers: Record<string, string>,
  cookies: string,
  body: string,
  generator: string,
): boolean {
  // Header patterns (regex, case-insensitive) - ALL listed must match.
  if (rule.headers) {
    for (const [name, pattern] of Object.entries(rule.headers)) {
      const value = headers[name.toLowerCase()] ?? '';
      if (!value) return false;
      if (!new RegExp(pattern, 'i').test(value)) return false;
    }
    return true;
  }
  // Cookie names — ANY match.
  if (rule.cookies && rule.cookies.some((c) => cookies.toLowerCase().includes(c.toLowerCase()))) {
    return true;
  }
  // Generator meta — ANY match.
  if (rule.generator && generator && rule.generator.some((g) => generator.toLowerCase().includes(g.toLowerCase()))) {
    return true;
  }
  // HTML substrings — ANY match.
  if (rule.html && body && rule.html.some((h) => body.includes(h))) {
    return true;
  }
  return false;
}

/** Find the first matching rule name in a category. */
function firstMatch(
  rules: Rule[],
  headers: Record<string, string>,
  cookies: string,
  body: string,
  generator: string,
): Rule | undefined {
  return rules.find((r) => ruleMatches(r, headers, cookies, body, generator));
}

/**
 * Detect technologies from an HTTP result.
 *
 * @param http The completed HTTP stage result (headers + body).
 * @param cookies Concatenated Set-Cookie header values (may be empty).
 */
export function checkTech(http: HttpResult, cookies = ''): TechResult {
  const headers = http.headers ?? {};
  const body = http.body ?? '';
  const generator = generatorMeta(body);

  const stack = new Set<string>();

  const cms = firstMatch(RULES.cms, headers, cookies, body, generator);
  const framework = firstMatch(RULES.framework, headers, cookies, body, generator);
  const cdn = firstMatch(RULES.cdn, headers, cookies, body, generator);
  const server = firstMatch(RULES.server, headers, cookies, body, generator);

  if (cms) stack.add(cms.name);
  if (framework) stack.add(framework.name);
  if (cdn) stack.add(cdn.name);
  if (server) stack.add(server.name);

  // Analytics are additive (a page can carry several).
  for (const rule of RULES.analytics) {
    if (ruleMatches(rule, headers, cookies, body, generator)) stack.add(rule.name);
  }

  const wordpress = cms?.wordpress === true;
  const cloudflare = cdn?.cloudflare === true || Boolean(headers['cf-ray']);

  return {
    wordpress,
    cms: cms?.name ?? '',
    framework: framework?.name ?? '',
    cdn: cdn?.name ?? '',
    cloudflare,
    stack: [...stack],
  };
}
