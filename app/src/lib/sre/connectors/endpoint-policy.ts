import { lookup } from "node:dns/promises";

function isSelfHosted() {
  return process.env.SELF_HOSTED === "true" || process.env.SELF_HOSTED === "1";
}

export function isPrivateConnectorAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPrivateConnectorAddress(normalized.slice("::ffff:".length));
  }

  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  ) {
    return true;
  }

  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

export async function assertEndpointAllowedForExecution(endpointUrl: string | null, usesPrivateAgent: boolean) {
  if (!endpointUrl || usesPrivateAgent || isSelfHosted()) {
    return;
  }

  const url = new URL(endpointUrl);
  if (url.protocol !== "https:") {
    throw new Error("Direct cloud connectors must use HTTPS. Use self-hosted mode or a Private Agent for HTTP private endpoints.");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Direct cloud connectors cannot target localhost. Use a Private Agent for private networks.");
  }

  const addresses = await lookup(hostname, { all: true, verbatim: false });
  if (addresses.some((entry) => isPrivateConnectorAddress(entry.address))) {
    throw new Error("Direct cloud connectors cannot target private IP ranges. Use a Private Agent for private networks.");
  }
}
