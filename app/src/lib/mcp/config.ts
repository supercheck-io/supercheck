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


/** Short-lived access tokens; refresh tokens carry the longer session. */
export const MCP_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const MCP_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);

/**
 * Reads an on/off setting. An unset or blank value is `defaultValue`; any
 * recognised "on" spelling is true; everything else (false, 0, no, off, or a
 * typo) is false. An operator who typed something unrecognisable most likely
 * meant "off", so these settings fail closed.
 */
function readFlag(value: string | undefined, defaultValue: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return defaultValue;
  return TRUE_VALUES.has(normalized);
}

/** The whole MCP server, including the OAuth server: off unless explicitly enabled. */
export function isMcpServerEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return readFlag(env.MCP_SERVER_ENABLED, false);
}

/**
 * Whether unauthenticated Dynamic Client Registration is accepted. Most MCP
 * clients still register this way; the 2026-07-28 spec prefers Client ID
 * Metadata Documents, which are always accepted. On by default; operators can
 * turn it off.
 */
export function isMcpDynamicRegistrationEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return readFlag(env.MCP_DYNAMIC_CLIENT_REGISTRATION, true);
}

function appBaseUrl(env: Record<string, string | undefined>): string {
  // Better Auth's base URL is BETTER_AUTH_URL and becomes the token issuer. Without it Better Auth
  // derives the issuer from each request's host, which can differ from this resource URL, so tokens
  // would carry an issuer and audience that disagree. Require it rather than guess.
  const value = env.BETTER_AUTH_URL?.trim();
  if (!value) {
    throw new Error(
      "MCP_SERVER_ENABLED requires BETTER_AUTH_URL to be set to the public URL of this server",
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
