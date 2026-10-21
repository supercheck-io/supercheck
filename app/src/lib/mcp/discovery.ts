import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@/utils/auth";
import { isMcpServerEnabled } from "./config";
import { withReachableEndpointsOnly } from "./http-policy";

/**
 * OAuth discovery documents (RFC 8414, RFC 9728).
 *
 * Better Auth serves them under its own base path (/api/auth/.well-known/...),
 * but its issuer carries a path, so RFC 8414 and RFC 9728 clients look for the
 * documents at the origin root with the issuer or resource path appended. These
 * handlers expose them there. They are public metadata: no credentials, and
 * readable cross-origin so browser-based MCP clients can discover the server.
 *
 * There is deliberately no OpenID Connect document: this is an OAuth-only server
 * (no `openid` scope), so Better Auth answers that endpoint with 404. Clients
 * fall back to the RFC 8414 document above.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
} as const;

function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404, headers: CORS_HEADERS });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function discoveryPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

type Handler = (request: Request) => Promise<Response>;

function guarded(build: () => Handler): Handler {
  return async (request) => {
    if (!isMcpServerEnabled()) return notFound();
    return withCors(await build()(request));
  };
}

export const authorizationServerMetadata = guarded(() => async (request) =>
  withReachableEndpointsOnly(await oauthProviderAuthServerMetadata(auth as never)(request)),
);

/** RFC 9728 protected-resource metadata, served by the MCP plugin via the auth handler. */
export const protectedResourceMetadata = guarded(() => (request: Request) => auth.handler(request));
