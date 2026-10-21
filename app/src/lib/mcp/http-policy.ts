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
const GUARDED_PREFIXES = ["/api/auth/oauth2", "/api/auth/admin/oauth2"];
const GUARDED_EXACT = new Set(["/api/auth/token"]);

const ALLOWED = new Set([
  "GET /api/auth/oauth2/authorize",
  "POST /api/auth/oauth2/authorize",
  "POST /api/auth/oauth2/token",
  "POST /api/auth/oauth2/register",
  "POST /api/auth/oauth2/revoke",
]);

function isGuarded(path: string): boolean {
  return (
    GUARDED_EXACT.has(path) ||
    GUARDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  );
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
