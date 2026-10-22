import { createHash } from "node:crypto";
import { apiKeyRateLimiter } from "@/lib/api-key-rate-limiter";
import { getClientIP } from "@/lib/session-security";

const LIMITS: Record<string, number> = {
  "/api/auth/oauth2/register": 5,
  "/api/auth/oauth2/authorize": 30,
  "/api/auth/oauth2/token": 60,
  "/api/auth/oauth2/revoke": 30,
};

export async function prepareMcpOAuthRequest(request: Request): Promise<Request | Response> {
  const path = decodeURIComponent(new URL(request.url).pathname).replace(/\/+$/, "");
  const maxRequests = LIMITS[path];
  if (!maxRequests) return request;

  const ip = getClientIP(request.headers);
  if (ip === "unknown") {
    return Response.json({ error: "Client address unavailable" }, { status: 503 });
  }
  const client = createHash("sha256").update(ip).digest("hex");
  const limit = await apiKeyRateLimiter.checkAndIncrement(`mcp:${path}:${client}`, {
    enabled: true, timeWindow: 60, maxRequests,
  });
  if (!limit.allowed) {
    return Response.json({ error: "Too many requests" }, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfter ?? 60) },
    });
  }

  // Better Auth must key its own limiter to the same trusted address.
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-for", ip);
  headers.delete("cf-connecting-ip");
  headers.delete("x-real-ip");
  return new Request(request, { headers });
}
