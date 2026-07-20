import type { NextConfig } from 'next';

/**
 * Origins the browser may call at runtime: the backend API and the GitHub
 * Pages cache. Read at build time from the same env vars the API client uses.
 */
const API_ORIGIN = originOf(process.env.NEXT_PUBLIC_API_BASE_URL) ?? 'http://localhost:4000';
const PAGES_ORIGIN = originOf(process.env.NEXT_PUBLIC_PAGES_BASE_URL);

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * Content-Security-Policy (audit C-9).
 *
 * - connect-src: self + API + Pages cache only — an injected script cannot
 *   exfiltrate the JWT to an attacker origin.
 * - img-src allows https: broadly — screenshots/favicons load from
 *   monitored-site hosts and the Pages CDN.
 * - script-src keeps 'unsafe-inline' because Next.js App Router injects
 *   inline bootstrap scripts; there is no third-party script surface.
 * - frame-ancestors 'none' replaces X-Frame-Options in modern browsers
 *   (the legacy header is still sent for older ones).
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${[API_ORIGIN, PAGES_ORIGIN].filter(Boolean).join(' ')}`,
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  transpilePackages: ['@uptime/shared'],
  images: {
    // Screenshots/thumbnails come from GitHub Pages; use plain <img> so no
    // remote loader config is needed, but keep this permissive for future use.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
