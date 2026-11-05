import { auth } from "@/utils/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { isOAuthEndpointDenied, withReachableEndpointsOnly } from "@/lib/mcp/http-policy";
import { isMcpServerEnabled } from "@/lib/mcp/config";
import { prepareMcpOAuthRequest } from "@/lib/mcp/request-policy";
import { isCredentialOwnerActive } from "@/lib/security/credential-owner";
import { isImpersonatedSession } from "@/lib/rbac/middleware";
import { getCachedAuthSession } from "@/lib/session-cache";

const handlers = toNextJsHandler(auth);

// Organization writes must use the dedicated APIs with app RBAC, limits and
// audit logging. Default-deny also covers new routes in future plugin releases.
const allowedOrganizationReads = new Set(["list"]);

function decodedPath(request: Request): string | null {
  try {
    return decodeURIComponent(new URL(request.url).pathname).replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function organizationPolicyError(request: Request) {
  let path: string;
  try {
    path = decodeURIComponent(new URL(request.url).pathname).replace(/\/+$/, "");
  } catch {
    return NextResponse.json({ error: "Invalid request path" }, { status: 400 });
  }
  // The api-key plugin would let any signed-in user mint keys directly (any prefix, no RBAC, no limits, no
  // audit trail). Keys are created only through the application's own routes.
  if (path === "/api/auth/api-key" || path.startsWith("/api/auth/api-key/")) {
    return NextResponse.json({ error: "API keys are managed through the application's token endpoints." }, { status: 403 });
  }
  // OAuth/JWT plugin endpoints: only what MCP clients need is reachable (see lib/mcp/http-policy.ts).
  // With the MCP server off the plugins are not registered, so these paths simply do not exist
  // (Better Auth answers 404); the policy only has something to protect when it is on.
  if (isMcpServerEnabled() && isOAuthEndpointDenied(request.method, path)) {
    return NextResponse.json({ error: "This endpoint is not available." }, { status: 403 });
  }
  if (path === "/api/auth/organization" || path.startsWith("/api/auth/organization/")) {
    const endpoint = path.slice("/api/auth/organization/".length);
    if (request.method === "GET" && allowedOrganizationReads.has(endpoint)) return;
    return NextResponse.json({ error: "Use the application's organization and project APIs. Direct organization operations are disabled." }, { status: 403 });
  }
}

// Account-level Better Auth endpoints. An impersonating super admin acts as the user for support, but must not
// change credentials, delete the account or touch sessions: the effects would outlive the impersonation.
const accountEndpoints = new Set([
  "change-password", "set-password", "change-email", "delete-user", "unlink-account",
  "list-sessions", "revoke-session", "revoke-sessions", "revoke-other-sessions",
]);

async function impersonationPolicyError(request: Request) {
  const path = decodedPath(request);
  const endpoint = path?.startsWith("/api/auth/") ? path.slice("/api/auth/".length) : null;
  if (!endpoint || !(accountEndpoints.has(endpoint) || endpoint.startsWith("two-factor/"))) return;
  // Anonymous callers fall through so Better Auth keeps answering 401.
  if (!(await getCachedAuthSession())) return;
  if (await isImpersonatedSession()) {
    return NextResponse.json({ error: "impersonation_not_allowed" }, { status: 403 });
  }
}

export async function POST(request: Request) {
  const denied = organizationPolicyError(request) ?? (await impersonationPolicyError(request));
  if (denied) return denied;
  const prepared = isMcpServerEnabled() ? await prepareMcpOAuthRequest(request) : request;
  return prepared instanceof Response ? prepared : handlers.POST(prepared);
}

export async function GET(request: Request) {
  const denied = organizationPolicyError(request) ?? (await impersonationPolicyError(request));
  if (denied) return denied;
  const prepared = isMcpServerEnabled() ? await prepareMcpOAuthRequest(request) : request;
  if (prepared instanceof Response) return prepared;
  const response = await handlers.GET(prepared);
  // The client session check: a session that outlived a suspension reads as signed out (expired bans pass).
  if (decodedPath(request) === "/api/auth/get-session" && response.ok) {
    const body = await response.clone().json().catch(() => null) as { user?: { banned?: unknown; banExpires?: unknown } } | null;
    if (body?.user && !isCredentialOwnerActive(body.user)) {
      return NextResponse.json(null, { headers: { "Cache-Control": "no-store" } });
    }
  }
  // Better Auth's own copy of the metadata lists endpoints this route refuses; advertise only reachable ones.
  if (isMcpServerEnabled() && new URL(request.url).pathname.replace(/\/+$/, "") === "/api/auth/.well-known/oauth-authorization-server") {
    return withReachableEndpointsOnly(response);
  }
  return response;
}
