/**
 * Which of the OAuth provider's HTTP endpoints are reachable.
 *
 * The OAuth and JWT plugins add dozens of routes under /api/auth, including
 * client and consent management, admin resource management, token
 * introspection, and a route that mints a JWT from a browser session. MCP
 * clients need only authorize, token, registration and revocation (plus the
 * JWKS and discovery documents, which are not guarded here). Everything else
 * stays available in-process but is refused over HTTP, mirroring how the
 * catch-all route default-denies API keys and organization writes.
 *
 * The connect screen and "Connected apps" use dedicated routes under
 * /api/oauth/mcp, which check the project selection and revoke tokens.
 */
// /api/auth/token mints a JWT from a browser session; guard it as a prefix so a sub-route a
// future release adds beneath it is denied too.
const GUARDED_PREFIXES = ["/api/auth/oauth2", "/api/auth/admin/oauth2", "/api/auth/token"];

const ALLOWED = new Set([
  "GET /api/auth/oauth2/authorize",
  "POST /api/auth/oauth2/authorize",
  "POST /api/auth/oauth2/token",
  "POST /api/auth/oauth2/register",
  "POST /api/auth/oauth2/revoke",
]);

function isGuarded(path: string): boolean {
  return GUARDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** True when this request targets an OAuth/JWT endpoint that is not exposed over HTTP. */
export function isOAuthEndpointDenied(method: string, rawPath: string): boolean {
  let path: string;
  try {
    path = decodeURIComponent(rawPath).replace(/\/+$/, "");
  } catch {
    // An undecodable path cannot name an allowed endpoint.
    return true;
  }
  if (!isGuarded(path)) return false;
  return !ALLOWED.has(`${method.toUpperCase()} ${path}`);
}

/**
 * Removes advertised endpoints that are not reachable over HTTP.
 *
 * The authorization-server metadata lists every endpoint the provider owns,
 * including ones refused above (token introspection). A client that follows the
 * metadata would be sent to a dead endpoint, so drop any `*_endpoint` whose path
 * is denied for every method, along with its `<name>_*` siblings (such as the
 * supported authentication methods). Derived from the same policy, so the two
 * cannot drift apart.
 */
export function pruneUnreachableEndpoints(metadata: Record<string, unknown>): Record<string, unknown> {
  const pruned = { ...metadata };
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (!key.endsWith("_endpoint") || typeof value !== "string") continue;
    let pathname: string;
    try {
      pathname = new URL(value).pathname;
    } catch {
      continue;
    }
    if (["GET", "POST"].every((method) => isOAuthEndpointDenied(method, pathname))) {
      delete pruned[key];
      dropped.push(key.slice(0, -"_endpoint".length));
    }
  }
  for (const name of dropped) {
    for (const key of Object.keys(pruned)) {
      if (key.startsWith(`${name}_endpoint_`)) delete pruned[key];
    }
  }
  return pruned;
}

/** Rewrites a successful JSON metadata response so it only advertises reachable endpoints. */
export async function withReachableEndpointsOnly(response: Response): Promise<Response> {
  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("json")) return response;
  const metadata = (await response.clone().json().catch(() => null)) as Record<string, unknown> | null;
  if (!metadata || typeof metadata !== "object") return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(pruneUnreachableEndpoints(metadata)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
