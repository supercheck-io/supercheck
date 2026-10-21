/**
 * Post-authentication continuation targets are restricted to an explicit
 * allowlist of local paths, so a crafted `?next=` can never become an open
 * redirect. Today only the device-approval page may be resumed.
 */
const DEVICE_PATH = /^\/device(?:\?code=[A-Za-z0-9-]{1,16})?$/;

export function sanitizeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 64) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  // Reject anything that is not a plain, single-slash local path.
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) {
    return null;
  }
  return DEVICE_PATH.test(value) ? value : null;
}

export function buildDeviceReturnPath(code: string | null | undefined): string {
  return code && /^[A-Za-z0-9-]{1,16}$/.test(code)
    ? `/device?code=${code}`
    : "/device";
}

/** The only OAuth endpoint a sign-in may resume into. */
export const OAUTH_AUTHORIZE_PATH = "/api/auth/oauth2/authorize";

const MAX_OAUTH_RESUME_QUERY = 4096;

/**
 * An MCP client that sends an unauthenticated user to authorize is redirected
 * to /sign-in carrying the original authorization request plus the signed
 * continuation parameters (`exp`, `sig`). After any sign-in method, replaying
 * that query against the authorize endpoint resumes the flow at consent.
 *
 * The target path is a constant, so this cannot become an open redirect; the
 * authorize endpoint validates the signature and the client's registered
 * redirect URI itself.
 */
export function buildOAuthResumePath(
  searchParams: Pick<URLSearchParams, "get" | "has" | "toString"> | null | undefined,
): string | null {
  if (!searchParams) return null;
  if (
    searchParams.get("response_type") !== "code" ||
    !searchParams.get("client_id") ||
    !searchParams.has("sig") ||
    !searchParams.has("exp")
  ) {
    return null;
  }
  const query = searchParams.toString();
  if (query.length === 0 || query.length > MAX_OAUTH_RESUME_QUERY) return null;
  return `${OAUTH_AUTHORIZE_PATH}?${query}`;
}

export function isOAuthResumePath(path: string | null | undefined): boolean {
  return typeof path === "string" && path.startsWith(`${OAUTH_AUTHORIZE_PATH}?`);
}
