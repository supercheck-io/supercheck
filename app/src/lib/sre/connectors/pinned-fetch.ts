import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

import { isSelfHosted } from "@/lib/feature-flags";
import {
  isMetadataOrLinkLocalAddress,
  isPrivateConnectorAddress,
  lookupBounded,
  METADATA_ADDRESS_ERROR,
} from "./endpoint-policy";
import { createPinnedLookup } from "./pinned-lookup";

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/**
 * Fetch a direct cloud connector through an address validated in the same DNS
 * resolution used by the TLS connection. Keeping the original hostname in the
 * request preserves Host/SNI and certificate verification while preventing a
 * second DNS lookup from rebinding the request to an internal address.
 */
async function fetchPinnedEndpoint(
  input: string | URL,
  init: RequestInit = {},
  allowSelfHostedPrivateNetworks = false,
  maxResponseBytes = MAX_RESPONSE_BYTES,
): Promise<Response> {
  const url = new URL(input);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Connector endpoints must use HTTP or HTTPS");
  }

  if (url.username || url.password) {
    throw new Error("Connector endpoints must not include URL credentials");
  }

  // Self-hosted administrators may target private services and loopback, but never cloud
  // metadata or link-local addresses. Both modes resolve once and pin the connection.
  const selfHosted = allowSelfHostedPrivateNetworks && isSelfHosted();
  if (!selfHosted && url.protocol !== "https:") {
    throw new Error("Direct cloud connectors must use HTTPS");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookupBounded(hostname, init.signal);
  if (addresses.length === 0) {
    throw new Error("Connector endpoint host did not resolve to an address");
  }
  if (selfHosted) {
    if (addresses.some(({ address }) => isMetadataOrLinkLocalAddress(address))) {
      throw new Error(METADATA_ADDRESS_ERROR);
    }
  } else if (addresses.some(({ address }) => isPrivateConnectorAddress(address))) {
    throw new Error(
      "Direct cloud connectors cannot target private or reserved IP ranges",
    );
  }

  const headers = new Headers(init.headers);
  headers.set("Accept-Encoding", "identity");
  if (typeof init.body === "string" || Buffer.isBuffer(init.body)) {
    headers.set("Content-Length", String(Buffer.byteLength(init.body)));
  }

  return new Promise<Response>((resolve, reject) => {
    // Every DNS answer passed the address policy and the socket lookup is pinned to that vetted set.
    const request = (url.protocol === "http:" ? http : https).request( // lgtm [js/request-forgery]
      url,
      {
        method: init.method ?? "GET",
        headers: Object.fromEntries(headers.entries()),
        lookup: createPinnedLookup(addresses),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        response.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > maxResponseBytes) {
            request.destroy(new Error(`Connector response exceeded ${maxResponseBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            const status = response.statusCode ?? 500;
            // Fetch forbids bodies for these statuses, including an empty Buffer.
            const body =
              [204, 205, 304].includes(status) ||
              init.method?.toUpperCase() === "HEAD"
                ? null
                : Buffer.concat(chunks);
            resolve(
              new Response(body, {
                status,
                statusText: response.statusMessage,
                headers: response.headers as HeadersInit,
              }),
            );
          } catch (error) {
            // Event callbacks run outside the Promise executor's catch boundary.
            reject(error);
          }
        });
      },
    );

    request.on("error", reject);
    if (init.signal) {
      const abort = () => {
        const reason: unknown = init.signal?.reason;
        request.destroy(
          reason instanceof Error
            ? reason
            : new Error("Connector request aborted"),
        );
      };
      if (init.signal.aborted) abort();
      else init.signal.addEventListener("abort", abort, { once: true });
      request.on("close", () =>
        init.signal?.removeEventListener("abort", abort),
      );
    }

    if (init.body !== undefined && init.body !== null) {
      if (typeof init.body !== "string" && !Buffer.isBuffer(init.body)) {
        request.destroy(new Error("Unsupported connector request body"));
        return;
      }
      request.end(init.body);
      return;
    }
    request.end();
  });
}

export function fetchConnectorEndpoint(
  input: string | URL,
  init: RequestInit = {},
  maxResponseBytes = MAX_RESPONSE_BYTES,
) {
  return fetchPinnedEndpoint(input, init, true, maxResponseBytes);
}

/** Public webhook variant: always validates and pins the destination. */
export async function fetchPublicEndpoint(
  input: string | URL,
  init: RequestInit = {},
  maxResponseBytes = MAX_RESPONSE_BYTES,
): Promise<Response> {
  return fetchPinnedEndpoint(input, init, false, maxResponseBytes);
}
