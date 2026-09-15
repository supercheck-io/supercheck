import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateOrReservedAddress } from "@/lib/outbound-address-policy";

function isSelfHosted() {
  return process.env.SELF_HOSTED === "true" || process.env.SELF_HOSTED === "1";
}

export function isPrivateConnectorAddress(address: string) {
  return isPrivateOrReservedAddress(address);
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
