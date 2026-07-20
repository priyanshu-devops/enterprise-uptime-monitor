/**
 * RDAP domain-registration lookup.
 *
 * Uses the public rdap.org bootstrap redirector to find the authoritative RDAP
 * server for a domain, then reads the registration expiry event and registrar.
 * Results are cached 7 days in per-domain state (handled by the caller), since
 * registration dates change rarely and RDAP endpoints rate-limit.
 */
import { getDomain } from 'tldts';
import { getGlobalDispatcher, interceptors, request } from 'undici';
import type { RdapResult } from '@uptime/shared';
import { opSignal } from './signal.js';

/** Dispatcher that follows rdap.org's bootstrap redirects to the registry. */
const redirectDispatcher = getGlobalDispatcher().compose(
  interceptors.redirect({ maxRedirections: 5 }),
);

/** RDAP event object shape (subset). */
interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}

/** RDAP entity object shape (subset). */
interface RdapEntity {
  roles?: string[];
  vcardArray?: unknown;
  handle?: string;
}

/** RDAP response shape (subset we consume). */
interface RdapResponse {
  events?: RdapEvent[];
  entities?: RdapEntity[];
}

/** Pull a readable registrar name from an RDAP entity's vCard. */
function registrarFromEntities(entities: RdapEntity[] | undefined): string {
  if (!entities) return '';
  const registrar = entities.find((e) => e.roles?.includes('registrar'));
  if (!registrar) return '';
  // vcardArray = ["vcard", [ ["version",...], ["fn", {}, "text", "Name"], ... ]]
  const vcard = registrar.vcardArray;
  if (Array.isArray(vcard) && Array.isArray(vcard[1])) {
    for (const entry of vcard[1] as unknown[]) {
      if (Array.isArray(entry) && entry[0] === 'fn' && typeof entry[3] === 'string') {
        return entry[3];
      }
    }
  }
  return registrar.handle ?? '';
}

/**
 * Perform the RDAP lookup for a hostname's registrable domain.
 *
 * @param hostname Any hostname; the registrable domain is derived via tldts.
 * @param timeoutMs Request timeout.
 */
export async function checkRdap(
  hostname: string,
  timeoutMs = 10_000,
  signal?: AbortSignal,
): Promise<RdapResult> {
  const registrable = getDomain(hostname) ?? hostname;
  try {
    const res = await request(`https://rdap.org/domain/${encodeURIComponent(registrable)}`, {
      method: 'GET',
      headers: { accept: 'application/rdap+json, application/json', 'user-agent': 'UptimeMonitor/1.0' },
      dispatcher: redirectDispatcher,
      signal: opSignal(timeoutMs, signal),
    });

    if (res.statusCode >= 400) {
      await res.body.dump().catch(() => undefined);
      return { ok: false, expiryDate: '', registrar: '', error: `RDAP HTTP ${res.statusCode}` };
    }

    const data = (await res.body.json()) as RdapResponse;
    const expiryEvent = data.events?.find(
      (e) => e.eventAction === 'expiration' || e.eventAction === 'registrar expiration',
    );
    const expiryDate = expiryEvent?.eventDate
      ? new Date(expiryEvent.eventDate).toISOString()
      : '';

    return {
      ok: true,
      expiryDate,
      registrar: registrarFromEntities(data.entities),
    };
  } catch (err) {
    return {
      ok: false,
      expiryDate: '',
      registrar: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
