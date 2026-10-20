import { auth } from "@/utils/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";

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
  return organizationPolicyError(request) ?? handlers.GET(request);
}
