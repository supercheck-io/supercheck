import { getAllowedCorsOriginPatterns, isCorsOriginAllowed } from "@/lib/cors";
import { requireMcpAuth } from "@better-auth/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { JWTPayload } from "jose";
import { auth } from "@/utils/auth";
import { logAuditEvent } from "@/lib/audit-logger";
import { getMcpResourceUrl, isMcpServerEnabled, MCP_READ_SCOPE } from "@/lib/mcp/config";
import { McpAccessDeniedError, resolveMcpCallContext } from "@/lib/mcp/context";
import { registerMcpTools } from "@/lib/mcp/tools";
import {
  McpBodyTooLargeError,
  admitMcpCall,
  countMcpMessages,
  isMcpRefusal,
  readMcpBody,
} from "@/lib/mcp/call-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status: number, extra: HeadersInit = {}): Response {
  const headers = new Headers(extra);
  headers.set("Cache-Control", NO_STORE["Cache-Control"]);
  return Response.json(body, { status, headers });
}

/** MCP clients expect a JSON-RPC error object, not an ad-hoc body, even for transport-level refusals. */
function rpcError(status: number, code: string, message: string, extra: HeadersInit = {}, rpcCode = -32000): Response {
  return json({ jsonrpc: "2.0", id: null, error: { code: rpcCode, message, data: { code } } }, status, extra);
}

async function handle(request: Request, claims: JWTPayload): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return rpcError(413, "payload_too_large", "Request body is too large");
  }

  // Read the body once, capped even without a Content-Length, and reuse it for the transport.
  let parsedBody: unknown;
  try {
    parsedBody = await readMcpBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof McpBodyTooLargeError) return rpcError(413, "payload_too_large", "Request body is too large");
    throw error;
  }

  if (parsedBody === undefined) return rpcError(400, "parse_error", "Parse error", {}, -32700);

  // Throttle per connected app and per user before any database work, so a flood costs a Redis call, not
  // several queries. A batch counts once per JSON-RPC message.
  const permit = await admitMcpCall(
    {
      user: typeof claims.sub === "string" ? claims.sub : "unknown",
      client: typeof claims.azp === "string" ? claims.azp : "unknown",
    },
    countMcpMessages(parsedBody),
  );
  if (isMcpRefusal(permit)) {
    const retry: Record<string, string> = permit.retryAfter ? { "Retry-After": String(permit.retryAfter) } : {};
    const message =
      permit.status === 429 ? "Too many requests" : permit.status === 503 ? "Rate limiting is temporarily unavailable" : "Batch is too large";
    return rpcError(permit.status, permit.error, message, retry);
  }

  try {
    let context;
    try {
      context = await resolveMcpCallContext(claims);
    } catch (error) {
      if (error instanceof McpAccessDeniedError) {
        // The reason (ban, revoked consent, lost membership) stays in the server log, not the response.
        console.warn("mcp access denied", error.reason);
        await logAuditEvent({
          userId: typeof claims.sub === "string" ? claims.sub : undefined,
          action: "mcp_access_denied",
          resource: "mcp",
          metadata: { reason: error.reason, clientId: claims.azp },
          success: false,
        });
        return rpcError(403, "access_denied", "Access denied");
      }
      console.error("mcp context resolution failed", error);
      return rpcError(500, "server_error", "Internal error");
    }

    // Stateless: a fresh server and transport per request, safe across replicas.
    const server = new McpServer({ name: "supercheck", version: "1.0.0" });
    registerMcpTools(server, context);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: MAX_BODY_BYTES,
      enableDnsRebindingProtection: true,
      allowedHosts: [new URL(getMcpResourceUrl()).host],
      // The shared CORS policy has already validated this exact origin in POST.
      allowedOrigins: [request.headers.get("origin") ?? new URL(getMcpResourceUrl()).origin],
    });
    await server.connect(transport);
    return await transport.handleRequest(request, parsedBody === undefined ? undefined : { parsedBody });
  } finally {
    permit.release();
  }
}

function hasTrustedRequestOrigin(request: Request, resource: URL): boolean {
  try {
    const authority = request.headers.get("host") ?? new URL(request.url).host;
    const host = new URL(`${resource.protocol}//${authority}`);
    if (host.host !== resource.host || host.username || host.password || host.pathname !== "/" || host.search || host.hash) return false;
    const origin = request.headers.get("origin");
    return !origin || (new URL(origin).origin === origin &&
      (origin === resource.origin || isCorsOriginAllowed(origin, getAllowedCorsOriginPatterns())));
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isMcpServerEnabled()) return rpcError(404, "not_found", "Not found");
  try {
    const resource = new URL(getMcpResourceUrl());
    if (!hasTrustedRequestOrigin(request, resource)) {
      return rpcError(403, "invalid_request_origin", "Invalid request origin");
    }
    // Next may expose an internal request URL behind a proxy; validate the public Host, not forwarded headers.
    const headers = new Headers(request.headers);
    headers.set("host", resource.host);
    const protectedHandler = requireMcpAuth(auth as never, handle, {
      resource: resource.toString(),
      requiredScopes: [MCP_READ_SCOPE],
    } as never);
    const response = await protectedHandler(new Request(request, { headers }));
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Cache-Control", "no-store");
    if (response.status >= 400) {
      const body = await response.clone().json().catch(() => null) as { jsonrpc?: string } | null;
      if (body?.jsonrpc !== "2.0") {
        responseHeaders.delete("content-length");
        const code = response.status === 401 ? "unauthorized" : response.status === 403 ? "access_denied" : "request_failed";
        return rpcError(response.status, code, response.status === 401 ? "Authentication required" : "Request refused", responseHeaders);
      }
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  } catch (error) {
    console.error("mcp request failed", error);
    return rpcError(503, "server_unavailable", "Service temporarily unavailable");
  }
}

function notAllowed(): Response {
  if (!isMcpServerEnabled()) return rpcError(404, "not_found", "Not found");
  return rpcError(405, "method_not_allowed", "Method not allowed", { Allow: "POST" }, -32601);
}

export const GET = notAllowed;
export const DELETE = notAllowed;
