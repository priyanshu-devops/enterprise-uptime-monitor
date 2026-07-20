/**
 * SSL/TLS check stage.
 *
 * Opens a raw TLS connection with SNI, reads the peer certificate and the
 * negotiated protocol. Records expiry, issuer, validity window, and SANs.
 * `valid` reflects both the certificate date window and chain trust (a
 * connection that completes `authorized` implies a trusted chain).
 */
import tls from 'node:tls';
import type { SslResult } from '@uptime/shared';

/** Empty result when TLS can't be established. */
function baseResult(): SslResult {
  return {
    ok: false,
    validTo: '',
    validFrom: '',
    daysRemaining: 0,
    issuer: '',
    tlsVersion: '',
    valid: false,
    subjectAltNames: '',
  };
}

/** Extract the issuer organisation (O) or common name (CN). */
function issuerName(issuer: tls.PeerCertificate['issuer'] | undefined): string {
  if (!issuer) return '';
  const rec = issuer as unknown as Record<string, string>;
  return rec.O || rec.CN || rec.OU || '';
}

/**
 * Perform the SSL/TLS check.
 *
 * @param hostname Bare hostname for SNI and cert-name matching.
 * @param timeoutMs Connection timeout.
 * @param port TLS port (default 443).
 * @param signal Optional external abort (e.g. the per-domain budget) that
 *   tears the socket down immediately instead of waiting out the timeout.
 */
export function checkSsl(
  hostname: string,
  timeoutMs = 10_000,
  port = 443,
  signal?: AbortSignal,
): Promise<SslResult> {
  return new Promise((resolve) => {
    const result = baseResult();
    let settled = false;

    const onAbort = (): void => {
      finish({ ...result, error: 'TLS check aborted (budget exceeded)' });
    };

    const finish = (r: SslResult): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(r);
    };

    if (signal?.aborted) {
      resolve({ ...result, error: 'TLS check aborted (budget exceeded)' });
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    const socket = tls.connect(
      {
        host: hostname,
        port,
        servername: hostname,
        // We still want the cert even if the chain is untrusted, so we can
        // report *why* it's invalid rather than just failing.
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate(true);
          const protocol = socket.getProtocol() ?? '';
          const authorized = socket.authorized;

          if (!cert || Object.keys(cert).length === 0) {
            finish({ ...result, error: 'No peer certificate' });
            return;
          }

          const validTo = cert.valid_to ? new Date(cert.valid_to).toISOString() : '';
          const validFrom = cert.valid_from ? new Date(cert.valid_from).toISOString() : '';
          const expiryMs = cert.valid_to ? Date.parse(cert.valid_to) : NaN;
          const daysRemaining = Number.isNaN(expiryMs)
            ? 0
            : Math.floor((expiryMs - Date.now()) / 86_400_000);

          const now = Date.now();
          const withinWindow =
            !Number.isNaN(expiryMs) &&
            expiryMs > now &&
            (cert.valid_from ? Date.parse(cert.valid_from) <= now : true);

          finish({
            ok: true,
            validTo,
            validFrom,
            daysRemaining,
            issuer: issuerName(cert.issuer),
            tlsVersion: protocol,
            valid: authorized && withinWindow,
            subjectAltNames: cert.subjectaltname ?? '',
            ...(authorized ? {} : { error: socket.authorizationError?.message ?? 'Untrusted chain' }),
          });
        } catch (err) {
          finish({ ...result, error: err instanceof Error ? err.message : String(err) });
        }
      },
    );

    socket.on('error', (err) => {
      finish({ ...result, error: err.message });
    });
    socket.on('timeout', () => {
      finish({ ...result, error: 'TLS connection timeout' });
    });
  });
}
