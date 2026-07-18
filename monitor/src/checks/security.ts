/**
 * Security-headers audit.
 *
 * Inspects the final response headers (from the HTTP stage) for six baseline
 * defensive headers and produces a grade string like "4/6 (missing: CSP, HSTS)".
 */
import type { SecurityHeadersResult } from '@uptime/shared';

/** The six headers we grade, with human labels for the "missing" list. */
const HEADER_CHECKS: { key: keyof SecurityHeadersResult; header: string; label: string }[] = [
  { key: 'csp', header: 'content-security-policy', label: 'CSP' },
  { key: 'hsts', header: 'strict-transport-security', label: 'HSTS' },
  { key: 'xFrameOptions', header: 'x-frame-options', label: 'X-Frame-Options' },
  { key: 'xContentTypeOptions', header: 'x-content-type-options', label: 'X-Content-Type-Options' },
  { key: 'referrerPolicy', header: 'referrer-policy', label: 'Referrer-Policy' },
  { key: 'permissionsPolicy', header: 'permissions-policy', label: 'Permissions-Policy' },
];

/**
 * Grade the security headers present on a response.
 *
 * @param headers Lowercased response headers from the HTTP stage.
 */
export function checkSecurityHeaders(headers: Record<string, string>): SecurityHeadersResult {
  const flags = {
    csp: false,
    hsts: false,
    xFrameOptions: false,
    xContentTypeOptions: false,
    referrerPolicy: false,
    permissionsPolicy: false,
  };
  const missing: string[] = [];
  let presentCount = 0;

  for (const check of HEADER_CHECKS) {
    const present = Boolean(headers[check.header]);
    (flags as Record<string, boolean>)[check.key] = present;
    if (present) presentCount++;
    else missing.push(check.label);
  }

  const grade =
    missing.length === 0
      ? `${presentCount}/6`
      : `${presentCount}/6 (missing: ${missing.join(', ')})`;

  return { ...flags, grade, presentCount };
}
