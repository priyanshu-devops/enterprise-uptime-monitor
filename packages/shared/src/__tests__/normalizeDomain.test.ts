import { describe, expect, it } from 'vitest';
import { dedupeDomains, normalizeDomain } from '../utils/normalizeDomain.js';

describe('normalizeDomain', () => {
  it('accepts a bare domain', () => {
    const r = normalizeDomain('example.com');
    expect(r.invalid).toBe(false);
    expect(r.domain).toBe('example.com');
    expect(r.website).toBe('https://example.com');
  });

  it('upgrades http to https and marks corrected', () => {
    const r = normalizeDomain('http://example.com');
    expect(r.website).toBe('https://example.com');
    expect(r.corrected).toBe(true);
  });

  it('strips www, paths, ports, and whitespace', () => {
    expect(normalizeDomain('  https://www.Example.com/path?q=1 ').domain).toBe('example.com');
    expect(normalizeDomain('example.com:8080').domain).toBe('example.com');
    expect(normalizeDomain('example.com/deep/path').domain).toBe('example.com');
  });

  it('keeps non-www subdomains', () => {
    expect(normalizeDomain('app.example.com').domain).toBe('app.example.com');
    expect(normalizeDomain('www.example.co.uk').domain).toBe('example.co.uk');
  });

  it('rejects invalid inputs', () => {
    expect(normalizeDomain('').invalid).toBe(true);
    expect(normalizeDomain('not a domain').invalid).toBe(true);
    expect(normalizeDomain('ftp://example.com').invalid).toBe(true);
    expect(normalizeDomain('localhost').invalid).toBe(true);
    expect(normalizeDomain('just-text').invalid).toBe(true);
  });

  it('handles pasted list debris', () => {
    const r = normalizeDomain('example.com,');
    expect(r.invalid).toBe(false);
    expect(r.domain).toBe('example.com');
    expect(r.corrected).toBe(true);
  });
});

describe('dedupeDomains', () => {
  it('keeps first occurrence, reports duplicates', () => {
    const rows = [
      { domain: 'a.com', n: 1 },
      { domain: 'b.com', n: 2 },
      { domain: 'a.com', n: 3 },
    ];
    const { unique, duplicates } = dedupeDomains(rows);
    expect(unique.map((r) => r.n)).toEqual([1, 2]);
    expect(duplicates.map((r) => r.n)).toEqual([3]);
  });
});
