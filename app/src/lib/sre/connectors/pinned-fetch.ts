import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";

import { isPrivateConnectorAddress } from "./endpoint-policy";
import { createPinnedLookup } from "./pinned-lookup";

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

function isSelfHosted() {
  return process.env.SELF_HOSTED === "true" || process.env.SELF_HOSTED === "1";
}

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

  if (allowSelfHostedPrivateNetworks && isSelfHosted()) {
    // Self-hosted connector administrators intentionally may target private services.
    return fetch(url, init); // lgtm [js/request-forgery]
  }

  if (url.protocol !== "https:") {
    throw new Error("Direct cloud connectors must use HTTPS");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateConnectorAddress(address))
  ) {
    throw new Error(
      "Direct cloud connectors cannot target private or reserved IP ranges",
    );
  }

  const selected = addresses[0];
  const headers = new Headers(init.headers);
  headers.set("Accept-Encoding", "identity");

  return new Promise<Response>((resolve, reject) => {
    // Every DNS answer is public and the socket lookup is pinned to that result.
    const request = https.request( // lgtm [js/request-forgery]
      url,
      {
        method: init.method ?? "GET",
        headers: Object.fromEntries(headers.entries()),
        lookup: createPinnedLookup(selected),
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
      request.write(init.body);
    }
    request.end();
  });
}

/** Errors the body stream once it passes maxBytes, matching the pinned path's cap. */
function capResponseBody(response: Response, maxBytes: number): Response {
  if (!response.body) return response;
  let total = 0;
  const limited = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          controller.error(new Error(`Connector response exceeded ${maxBytes} bytes`));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(limited, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function fetchConnectorEndpoint(
  input: string | URL,
  init: RequestInit = {},
  maxResponseBytes = MAX_RESPONSE_BYTES,
) {
  // The self-hosted private-network path uses plain fetch; give it the pinned path's body cap.
  return fetchPinnedEndpoint(input, init, true, maxResponseBytes).then((response) =>
    isSelfHosted() ? capResponseBody(response, maxResponseBytes) : response,
  );
}

/** Public webhook variant: always validates and pins the destination. */
export async function fetchPublicEndpoint(
  input: string | URL,
  init: RequestInit = {},
  maxResponseBytes = MAX_RESPONSE_BYTES,
): Promise<Response> {
  return fetchPinnedEndpoint(input, init, false, maxResponseBytes);
}
