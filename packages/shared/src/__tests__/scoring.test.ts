import { describe, expect, it } from 'vitest';
import type { CheckResult, DomainState } from '../types/check.js';
import { computeHealthScore, daysUntil } from '../scoring/health.js';
import { computeRiskScore } from '../scoring/risk.js';

/** Build a healthy baseline CheckResult, then override per test. */
function baseline(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    domain: 'example.com',
    website: 'https://example.com',
    checkedAt: new Date().toISOString(),
    status: 'UP',
    dns: { ok: true, a: ['1.2.3.4'], aaaa: [], mx: [], txt: [], caa: [], nameservers: ['ns1'], summary: 'A', },
    http: {
      ok: true, status: 200, https: true, finalUrl: 'https://example.com/', redirectChain: [],
      redirectCount: 0, ttfbMs: 200, totalMs: 600, downloadMs: 100, contentSizeBytes: 50_000,
      compression: 'gzip', cacheHeaders: '', cookieCount: 0, headers: {}, body: '', server: '', poweredBy: '',
    },
    ssl: {
      ok: true, validTo: futureIso(90), validFrom: pastIso(30), daysRemaining: 90,
      issuer: "Let's Encrypt", tlsVersion: 'TLSv1.3', valid: true, subjectAltNames: '',
    },
    rdap: { ok: true, expiryDate: futureIso(365), registrar: 'Reg' },
    hosting: { ok: true, isp: 'ISP', org: 'Org', asn: 'AS1', country: 'US' },
    content: { metaTitle: 'T', metaDescription: 'D', canonicalUrl: '', faviconUrl: '', faviconPresent: true },
    crawlFiles: { robotsTxt: true, sitemapXml: true },
    securityHeaders: {
      csp: true, hsts: true, xFrameOptions: true, xContentTypeOptions: true,
      referrerPolicy: true, permissionsPolicy: true, grade: '6/6', presentCount: 6,
    },
    tech: { wordpress: false, cms: '', framework: '', cdn: '', cloudflare: false, stack: [] },
    screenshot: { ok: true, desktopPath: '', mobilePath: '', thumbPath: '' },
    healthScore: 0,
    riskScore: 0,
    errorMessage: '',
    durationMs: 1000,
    circuitOpen: false,
    ...overrides,
  };
}

function futureIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}
function pastIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

describe('computeHealthScore', () => {
  it('scores a perfect site 100', () => {
    expect(computeHealthScore(baseline()).score).toBe(100);
  });

  it('penalizes a down site by 60', () => {
    const r = computeHealthScore(baseline({ status: 'DOWN' }));
    expect(r.score).toBe(40);
  });

  it('penalizes DNS failure by 60', () => {
    expect(computeHealthScore(baseline({ status: 'DNS_FAILURE' })).score).toBe(40);
  });

  it('penalizes 5xx by 40 and 4xx by 25', () => {
    const b5 = baseline();
    b5.http.status = 503;
    expect(computeHealthScore(b5).score).toBe(60);
    const b4 = baseline();
    b4.http.status = 404;
    expect(computeHealthScore(b4).score).toBe(75);
  });

  it('penalizes expired SSL by 30, <7d by 20, <30d by 10', () => {
    const expired = baseline();
    expired.ssl.daysRemaining = -1;
    expect(computeHealthScore(expired).score).toBe(70);
    const soon = baseline();
    soon.ssl.daysRemaining = 3;
    expect(computeHealthScore(soon).score).toBe(80);
    const month = baseline();
    month.ssl.daysRemaining = 20;
    expect(computeHealthScore(month).score).toBe(90);
  });

  it('caps security-header penalty at 12', () => {
    const b = baseline();
    b.securityHeaders.presentCount = 0;
    expect(computeHealthScore(b).score).toBe(88);
  });

  it('penalizes slow responses', () => {
    const slow = baseline();
    slow.http.totalMs = 4000;
    expect(computeHealthScore(slow).score).toBe(90);
    const warn = baseline();
    warn.http.totalMs = 2000;
    expect(computeHealthScore(warn).score).toBe(95);
  });

  it('never goes below 0', () => {
    const b = baseline({ status: 'DOWN' });
    b.ssl.daysRemaining = -5;
    b.securityHeaders.presentCount = 0;
    b.content.faviconPresent = false;
    b.crawlFiles.robotsTxt = false;
    b.crawlFiles.sitemapXml = false;
    b.http.redirectCount = 5;
    const r = computeHealthScore(b);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe('computeRiskScore', () => {
  it('scores a healthy stable site 0', () => {
    expect(computeRiskScore(baseline()).score).toBe(0);
  });

  it('adds 25 for a down site', () => {
    expect(computeRiskScore(baseline({ status: 'DOWN' })).score).toBe(25);
  });

  it('adds flap penalty from state', () => {
    const state: DomainState = {
      consecutiveFailures: 0,
      lastStatus: 'UP',
      recentStatuses: ['UP', 'DOWN', 'UP', 'DOWN', 'UP'],
    };
    expect(computeRiskScore(baseline(), state).score).toBe(10);
  });

  it('stacks SSL and domain expiry buckets', () => {
    const b = baseline();
    b.ssl.daysRemaining = 5; // 25
    b.rdap.expiryDate = futureIso(20); // 12
    expect(computeRiskScore(b).score).toBe(37);
  });

  it('clamps at 100', () => {
    const b = baseline({ status: 'DOWN' });
    b.ssl.daysRemaining = -1;
    b.rdap.expiryDate = pastIso(1);
    b.http.https = false;
    b.securityHeaders.hsts = false;
    b.securityHeaders.csp = false;
    const state: DomainState = {
      consecutiveFailures: 3,
      lastStatus: 'DOWN',
      recentStatuses: ['DOWN', 'DOWN', 'DOWN'],
    };
    const r = computeRiskScore(b, state);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThan(80);
  });
});

describe('daysUntil', () => {
  it('returns null for empty/invalid', () => {
    expect(daysUntil('')).toBeNull();
    expect(daysUntil('not-a-date')).toBeNull();
  });
  it('computes future days', () => {
    const d = daysUntil(futureIso(10));
    expect(d).toBeGreaterThanOrEqual(9);
    expect(d).toBeLessThanOrEqual(10);
  });
});
