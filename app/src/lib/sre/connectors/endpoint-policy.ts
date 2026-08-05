import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isSelfHosted() {
  return process.env.SELF_HOSTED === "true" || process.env.SELF_HOSTED === "1";
}

export function isPrivateConnectorAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.startsWith("::ffff:")) {
    return isPrivateConnectorAddress(normalized.slice("::ffff:".length));
  }

  if (
    normalized === "::" ||
    normalized === "::1" ||
    /^fe[89ab][0-9a-f]:/.test(normalized) ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  ) {
    return true;
  }

  const parts = address.split(".").map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some(
      (part) => !Number.isInteger(part) || part < 0 || part > 255,
    )
  ) {
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
    (first === 169 && second === 254) ||
    (first === 192 && second === 0 && (parts[2] === 0 || parts[2] === 2)) ||
    (first === 192 && second === 88 && parts[2] === 99) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && parts[2] === 100) ||
    (first === 203 && second === 0 && parts[2] === 113) ||
    first >= 224
  );
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

  if (usesPrivateAgent || isSelfHosted()) {
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

  const addresses = await lookup(hostname, { all: true, verbatim: false });
  if (addresses.some((entry) => isPrivateConnectorAddress(entry.address))) {
    throw new Error("Direct cloud connectors cannot target private or reserved IP ranges. Use a Private Agent for private networks.");
  }
}
