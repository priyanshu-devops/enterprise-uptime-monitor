/**
 * Content / SEO parsing stage.
 *
 * Parses the HTML body captured by the HTTP stage (no extra network request)
 * to extract the page title, meta description, canonical URL, and favicon.
 */
import { parse } from 'node-html-parser';
import type { ContentResult } from '@uptime/shared';

/** Empty content result. */
function baseResult(): ContentResult {
  return {
    metaTitle: '',
    metaDescription: '',
    canonicalUrl: '',
    faviconUrl: '',
    faviconPresent: false,
  };
}

/**
 * Parse SEO/content fields from an HTML body.
 *
 * @param body Raw HTML (may be partial/capped).
 * @param finalUrl The URL the body was fetched from (for resolving favicon).
 */
export function checkContent(body: string, finalUrl: string): ContentResult {
  if (!body) return baseResult();

  let root;
  try {
    root = parse(body, { comment: false });
  } catch {
    return baseResult();
  }

  const title = root.querySelector('title')?.text?.trim() ?? '';

  const metaDescription =
    root
      .querySelector('meta[name="description"]')
      ?.getAttribute('content')
      ?.trim() ??
    root.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ??
    '';

  const canonicalHref = root.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() ?? '';
  const canonicalUrl = canonicalHref ? resolveUrl(canonicalHref, finalUrl) : '';

  // Favicon: explicit <link rel="icon"> variants, else default /favicon.ico.
  const iconLink = root
    .querySelectorAll('link[rel]')
    .find((el) => (el.getAttribute('rel') ?? '').toLowerCase().includes('icon'));
  const iconHref = iconLink?.getAttribute('href')?.trim() ?? '';
  const faviconUrl = iconHref
    ? resolveUrl(iconHref, finalUrl)
    : finalUrl
      ? resolveUrl('/favicon.ico', finalUrl)
      : '';
  const faviconPresent = Boolean(iconHref);

  return {
    metaTitle: title.slice(0, 500),
    metaDescription: metaDescription.slice(0, 1000),
    canonicalUrl,
    faviconUrl,
    faviconPresent,
  };
}

/** Resolve a possibly-relative URL against a base. */
function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}
