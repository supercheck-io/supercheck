import * as tls from 'tls';
import type { LookupFunction } from 'node:net';

export type CertificateReading =
  | { validTo: string; daysRemaining: number; issuer: string }
  | { invalid: true; reason: string };

/** Node/OpenSSL codes for a certificate that fails verification (expired, self-signed, wrong host, ...). */
export const TLS_CERT_ERROR =
  /^(CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT|UNABLE_TO_(VERIFY_LEAF_SIGNATURE|GET_ISSUER_CERT)|ERR_TLS_CERT_ALTNAME_INVALID)/;

/**
 * Connect with certificate validation on, only to the addresses `lookup` yields (build it with
 * `vettedLookup`). A certificate that fails verification resolves as `{ invalid, reason }`; any other
 * connection failure rejects.
 */
export function readCertificate(options: {
  hostname: string;
  port: number;
  lookup: LookupFunction;
  timeoutMs: number;
}): Promise<CertificateReading> {
  const { hostname, port, lookup, timeoutMs } = options;
  return new Promise<CertificateReading>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn();
    };

    const socket = tls.connect(
      { host: hostname, lookup, port, servername: hostname },
      () =>
        finish(() => {
          const cert = socket.getPeerCertificate();
          const validTo = new Date(cert?.valid_to);
          if (Number.isNaN(validTo.getTime())) {
            return reject(new Error('Certificate has no expiry date'));
          }
          resolve({
            validTo: validTo.toISOString(),
            daysRemaining: Math.ceil(
              (validTo.getTime() - Date.now()) / 86_400_000,
            ),
            issuer: String(cert.issuer?.CN ?? 'Unknown').slice(0, 120),
          });
        }),
    );

    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new Error(`SSL connection timeout after ${timeoutMs}ms`)),
        ),
      timeoutMs,
    );

    socket.on('error', (error: NodeJS.ErrnoException) =>
      finish(() =>
        typeof error.code === 'string' && TLS_CERT_ERROR.test(error.code)
          ? resolve({ invalid: true, reason: error.code })
          : reject(error),
      ),
    );
  });
}
