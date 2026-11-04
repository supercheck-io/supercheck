const CODE_MESSAGES: Record<string, string> = {
  ECONNREFUSED: "Connection refused: nothing is accepting connections at the endpoint host and port",
  ETIMEDOUT: "Connection timed out: the endpoint did not respond",
  ENOTFOUND: "Could not resolve the endpoint host",
  EAI_AGAIN: "Could not resolve the endpoint host (DNS lookup failed)",
  ECONNRESET: "Connection reset by the endpoint",
  EHOSTUNREACH: "The endpoint host is unreachable",
  ENETUNREACH: "The endpoint network is unreachable",
  CERT_HAS_EXPIRED: "TLS certificate error: the endpoint certificate has expired",
  DEPTH_ZERO_SELF_SIGNED_CERT: "TLS certificate error: the endpoint uses a self-signed certificate",
  SELF_SIGNED_CERT_IN_CHAIN: "TLS certificate error: the certificate chain contains a self-signed certificate",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS certificate error: the certificate chain could not be verified",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "TLS certificate error: the certificate issuer is not trusted",
  ERR_TLS_CERT_ALTNAME_INVALID: "TLS certificate error: the certificate does not match the endpoint host name",
};

/**
 * Turns the opaque "fetch failed" (the real reason is on error.cause) into a message an admin can act on.
 * Falls back to the original message when no known network or certificate code is found.
 */
export function describeConnectionError(error: unknown, fallback: string): string {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && CODE_MESSAGES[code]) return `${CODE_MESSAGES[code]} (${code})`;
    current = (current as { cause?: unknown }).cause;
  }
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "Request timed out before the endpoint responded";
    return error.message;
  }
  return fallback;
}
