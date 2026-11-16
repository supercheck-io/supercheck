import * as tls from 'tls';
import type { LookupFunction } from 'node:net';

export interface PeerCertificateInfo {
  certificate: tls.DetailedPeerCertificate;
  authorized: boolean;
  authorizationError?: Error;
}

/**
 * Open a TLS connection only to the addresses `lookup` yields (build it with `vettedLookup`) and read
 * the peer certificate. Invalid or expired certificates are still returned so callers can report them.
 */
export function readPeerCertificate(options: {
  hostname: string;
  port: number;
  lookup: LookupFunction;
  timeoutMs: number;
}): Promise<PeerCertificateInfo> {
  const { hostname, port, lookup, timeoutMs } = options;
  return new Promise<PeerCertificateInfo>((resolve, reject) => {
    let isResolved = false;

    const socket = tls.connect(
      {
        host: hostname,
        lookup, // Node's default autoSelectFamily falls back across the vetted addresses
        port,
        rejectUnauthorized: false, // Allow connection to inspect invalid/expired certificates
        servername: hostname, // SNI support for proper certificate validation
        secureProtocol: 'TLS_method', // Use modern TLS
        // Don't set socket timeout here to avoid dual timeout issue
      },
      () => {
        if (!isResolved) {
          isResolved = true;
          const cert = socket.getPeerCertificate(true);
          const authorized = socket.authorized;
          const authorizationError = socket.authorizationError;

          clearTimeout(timeoutHandle);
          socket.destroy();
          resolve({ certificate: cert, authorized, authorizationError });
        }
      },
    );

    // Single timeout mechanism to avoid conflicts
    const timeoutHandle = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        reject(new Error(`SSL connection timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    socket.on('error', (error) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timeoutHandle);
        socket.destroy();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}
