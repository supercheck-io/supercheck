import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Address4, Address6 } from "ip-address";
import { isPrivateOrReservedAddress } from "@/lib/outbound-address-policy";

function isSelfHosted() {
  return process.env.SELF_HOSTED === "true" || process.env.SELF_HOSTED === "1";
}

export function isPrivateConnectorAddress(address: string) {
  return isPrivateOrReservedAddress(address);
}

const METADATA_IPV4_NETWORKS = ["169.254.0.0/16", "100.100.100.200/32", "168.63.129.16/32", "192.0.0.192/32"].map(
  (network) => new Address4(network),
);
const LINK_LOCAL_IPV6 = new Address6("fe80::/10");

/**
 * Cloud metadata and link-local addresses stay blocked even for self-hosted
 * connectors; loopback and private ranges remain allowed there.
 */
export function isMetadataOrLinkLocalAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  if (family === 4) {
    const candidate = new Address4(normalized);
    return METADATA_IPV4_NETWORKS.some((network) => candidate.isHostInSubnet(network));
  }
  if (family === 6) {
    const candidate = new Address6(normalized);
    const embedded = candidate.embeddedIPv4();
    if (embedded && (candidate.isMapped4() || candidate.is4())) {
      return METADATA_IPV4_NETWORKS.some((network) => embedded.isHostInSubnet(network));
    }
    return candidate.isHostInSubnet(LINK_LOCAL_IPV6);
  }
  return false;
}

export const METADATA_ADDRESS_ERROR =
  "Connector endpoints cannot target cloud metadata or link-local addresses.";

const DNS_LOOKUP_TIMEOUT_MS = 10_000;

/** DNS lookup bounded by the caller's abort signal and a default timeout. */
export async function lookupBounded(hostname: string, signal?: AbortSignal | null) {
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("DNS lookup timed out")), DNS_LOOKUP_TIMEOUT_MS);
    if (signal) {
      onAbort = () => reject(new Error("DNS lookup aborted"));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  try {
    return await Promise.race([lookup(hostname, { all: true, verbatim: true }), bound]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    bound.catch(() => undefined);
  }
}

export async function assertEndpointAllowedForExecution(endpointUrl: string | null, usesPrivateAgent: boolean) {
  if (!endpointUrl) {
    return;
  }

  const url = new URL(endpointUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Connector endpoints must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error(
      "Connector endpoints cannot include credentials in the URL. Store credentials in the connector credential fields.",
    );
  }

  if (usesPrivateAgent) {
    return;
  }

  if (isSelfHosted()) {
    const selfHost = url.hostname.replace(/^\[|\]$/g, "");
    const resolved = isIP(selfHost)
      ? [{ address: selfHost }]
      : await lookupBounded(selfHost).catch(() => []);
    if (resolved.some((entry) => isMetadataOrLinkLocalAddress(entry.address))) {
      throw new Error(METADATA_ADDRESS_ERROR);
    }
    return;
  }

  if (url.protocol !== "https:") {
    throw new Error("Direct cloud connectors must use HTTPS. Use self-hosted mode or a Private Agent for HTTP private endpoints.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Direct cloud connectors cannot target localhost. Use a Private Agent for private networks.");
  }

  if (isIP(hostname) && isPrivateConnectorAddress(hostname)) {
    throw new Error("Direct cloud connectors cannot target private or reserved IP ranges. Use a Private Agent for private networks.");
  }

  const addresses = await lookupBounded(hostname);
  if (addresses.some((entry) => isPrivateConnectorAddress(entry.address))) {
    throw new Error("Direct cloud connectors cannot target private or reserved IP ranges. Use a Private Agent for private networks.");
  }
}
