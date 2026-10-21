import { auth } from "@/utils/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { isOAuthEndpointDenied, withReachableEndpointsOnly } from "@/lib/mcp/http-policy";
import { isMcpServerEnabled } from "@/lib/mcp/config";

const handlers = toNextJsHandler(auth);

// Organization writes must use the dedicated APIs with app RBAC, limits and
// audit logging. Default-deny also covers new routes in future plugin releases.
const allowedOrganizationReads = new Set(["list"]);

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

export async function POST(request: Request) {
  return organizationPolicyError(request) ?? handlers.POST(request);
}

export async function GET(request: Request) {
  const denied = organizationPolicyError(request);
  if (denied) return denied;
  const response = await handlers.GET(request);
  // Better Auth's own copy of the metadata lists endpoints this route refuses; advertise only reachable ones.
  if (isMcpServerEnabled() && new URL(request.url).pathname.replace(/\/+$/, "") === "/api/auth/.well-known/oauth-authorization-server") {
    return withReachableEndpointsOnly(response);
  }
  return response;
}
