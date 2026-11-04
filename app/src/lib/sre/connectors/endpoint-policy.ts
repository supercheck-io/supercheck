import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Address4, Address6 } from "ip-address";
import { isSelfHosted } from "@/lib/feature-flags";
import { isPrivateOrReservedAddress } from "@/lib/outbound-address-policy";


/** Stored MCP URLs may carry a key in the query, so responses show only `?…`. */
export function redactEndpointQuery(value: unknown) {
  if (typeof value !== "string") return null;
  const at = value.indexOf("?");
  return at === -1 ? value : `${value.slice(0, at)}?…`;
}

/** Tool-call and log summaries of a job spec: its endpoint query may hold a key under any name. */
export function summarizeJobSpec(jobSpec: unknown) {
  const spec = jobSpec && typeof jobSpec === "object" && "endpointUrl" in jobSpec
    ? { ...jobSpec, endpointUrl: redactEndpointQuery((jobSpec as { endpointUrl?: unknown }).endpointUrl) }
    : jobSpec;
  return JSON.stringify(spec);
}

export function isPrivateConnectorAddress(address: string) {
  return isPrivateOrReservedAddress(address);
}

const METADATA_IPV4_NETWORKS = ["169.254.0.0/16", "100.100.100.200/32", "168.63.129.16/32", "192.0.0.192/32"].map(
  (network) => new Address4(network),
);
const LINK_LOCAL_IPV6 = [new Address6("fe80::/10"), new Address6("fd00:ec2::254/128")];

const NAT64_NETWORKS = [new Address6("64:ff9b::/96")];
// Local-use NAT64 prefix: the embedded address position varies, so the whole /48 is blocked.
const NAT64_LOCAL_USE = new Address6("64:ff9b:1::/48");
const IPV4_COMPATIBLE = new Address6("::/96");
const SIX_TO_FOUR = new Address6("2002::/16");

/** IPv4 carried inside an IPv6 address by mapping, NAT64, 6to4 or the deprecated ::/96 form. */
function embeddedIpv4(candidate: Address6) {
  const bytes = candidate.toByteArray();
  const at = (offset: number) => Address4.fromHex(
    bytes.slice(offset, offset + 4).map((b) => b.toString(16).padStart(2, "0")).join(""),
  );
  if (candidate.isMapped4() || candidate.isHostInSubnet(IPV4_COMPATIBLE) || NAT64_NETWORKS.some((n) => candidate.isHostInSubnet(n))) return at(12);
  if (candidate.isHostInSubnet(SIX_TO_FOUR)) return at(2);
  return null;
}

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
    const embedded = embeddedIpv4(candidate);
    if (embedded && METADATA_IPV4_NETWORKS.some((network) => embedded.isHostInSubnet(network))) {
      return true;
    }
    return candidate.isHostInSubnet(NAT64_LOCAL_USE) || LINK_LOCAL_IPV6.some((network) => candidate.isHostInSubnet(network));
  }
  return false;
}

export const METADATA_ADDRESS_ERROR =
  "Connector endpoints cannot target cloud metadata or link-local addresses.";

const DNS_LOOKUP_TIMEOUT_MS = 10_000;

/** A DNS failure worth a plain message; other policy errors are policy blocks. */
export class HostResolutionError extends Error {}

/** DNS lookup bounded by the caller's abort signal and a default timeout. */
export async function lookupBounded(hostname: string, signal?: AbortSignal | null) {
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HostResolutionError(`DNS lookup for ${hostname} timed out`)), DNS_LOOKUP_TIMEOUT_MS);
    if (signal) {
      onAbort = () => reject(new Error("DNS lookup aborted"));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  try {
    return await Promise.race([lookup(hostname, { all: true, verbatim: true }), bound]);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      throw new HostResolutionError(`Could not resolve host ${hostname}`);
    }
    throw error;
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
