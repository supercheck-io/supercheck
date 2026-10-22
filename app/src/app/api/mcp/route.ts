import { requireMcpAuth } from "@better-auth/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { JWTPayload } from "jose";
import { auth } from "@/utils/auth";
import { logAuditEvent } from "@/lib/audit-logger";
import { getMcpResourceUrl, isMcpServerEnabled, MCP_READ_SCOPE } from "@/lib/mcp/config";
import { McpAccessDeniedError, resolveMcpCallContext } from "@/lib/mcp/context";
import { registerMcpTools } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

async function handle(request: Request, claims: JWTPayload): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

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
      return json({ error: "access_denied" }, 403);
    }
    console.error("mcp context resolution failed", error);
    return json({ error: "server_error" }, 500);
  }

  // Stateless: a fresh server and transport per request, safe across replicas.
  const server = new McpServer({ name: "supercheck", version: "1.0.0" });
  registerMcpTools(server, context);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_BODY_BYTES,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  if (!isMcpServerEnabled()) return json({ error: "not_found" }, 404);
  const protectedHandler = requireMcpAuth(auth as never, handle, {
    resource: getMcpResourceUrl(),
    requiredScopes: [MCP_READ_SCOPE],
  } as never);
  return protectedHandler(request);
}

function notAllowed(): Response {
  if (!isMcpServerEnabled()) return json({ error: "not_found" }, 404);
  return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
}

export const GET = notAllowed;
export const DELETE = notAllowed;
