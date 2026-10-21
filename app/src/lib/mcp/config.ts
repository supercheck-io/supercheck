/**
 * Configuration for the remote MCP server and its OAuth 2.1 authorization
 * server. Everything is off unless `MCP_SERVER_ENABLED=true`, so default
 * deployments, including self-hosted ones, are unchanged.
 */

/** Path of the MCP endpoint. Tokens are audience-bound to this URL. */
export const MCP_RESOURCE_PATH = "/api/mcp";

/** The only scope the read-only server grants. */
export const MCP_READ_SCOPE = "mcp:read";

/** Scopes this authorization server advertises and accepts. */
export const MCP_SCOPES = [MCP_READ_SCOPE, "offline_access"] as const;

/** JWT claim carrying the project a consent was granted for. */
export const MCP_PROJECT_CLAIM = "https://supercheck.io/project";

/** Seconds the project chosen on the connect screen stays usable. */
export const MCP_PROJECT_SELECTION_TTL_SECONDS = 10 * 60;

/** Short-lived access tokens; refresh tokens carry the longer session. */
export const MCP_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const MCP_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export function isMcpServerEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.MCP_SERVER_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * Whether unauthenticated Dynamic Client Registration is accepted. Most MCP
 * clients still register this way; the 2026-07-28 spec prefers Client ID
 * Metadata Documents, which are always accepted. Operators can turn DCR off.
 */
export function isMcpDynamicRegistrationEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.MCP_DYNAMIC_CLIENT_REGISTRATION?.trim().toLowerCase() !== "false";
}

function appBaseUrl(env: Record<string, string | undefined>): string {
  const value = env.APP_URL || env.BETTER_AUTH_URL || env.NEXT_PUBLIC_APP_URL;
  if (!value) {
    throw new Error(
      "MCP_SERVER_ENABLED requires APP_URL (or BETTER_AUTH_URL) to be set",
    );
  }
  return value;
}

/**
 * The canonical protected-resource URL. It must be HTTPS (loopback may use
 * HTTP for local development) with no query, fragment or credentials, because
 * issued tokens are bound to it.
 */
export function getMcpResourceUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const url = new URL(MCP_RESOURCE_PATH, appBaseUrl(env));
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("The MCP resource URL must use HTTPS");
  }
  return url.toString();
}
