/**
 * Post-authentication continuation targets are restricted to an explicit
 * allowlist of local paths, so a crafted `?next=` can never become an open
 * redirect. Only the device-approval page, the organization admin page (re-sign-in before deleting an
 * organization), organization switching and the pre-filled monitor form may be resumed.
 */
const DEVICE_PATH = /^\/(?:device(?:\?code=[A-Za-z0-9-]{1,16})?|org-admin|switch-organization\?org=[0-9a-fA-F-]{36})$/;

/**
 * "Monitor this" from the free tools on supercheck.io: a pre-filled monitor form. Values stay
 * percent-encoded (only unreserved characters and `%` are allowed), so the path can't gain a
 * parameter, a fragment or another route.
 */
const MONITOR_CREATE_PATH =
  /^\/monitors\/create\?type=(?:website|http_request)&url=[A-Za-z0-9%._~-]{1,6200}(?:&name=[A-Za-z0-9%._~-]{1,300})?(?:&method=(?:GET|HEAD))?$/;
const MAX_MONITOR_CREATE_PATH = 6600;

export function sanitizeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  // Callers pass searchParams.get("next"), already decoded once: match it as-is, before any decoding.
  if (raw.length <= MAX_MONITOR_CREATE_PATH && MONITOR_CREATE_PATH.test(raw)) return raw;
  if (raw.length > 128) return null;
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

/** The sanitized `next` of the current page, read in the browser only (event handlers and effects). */
export function currentNextPath(): string | null {
  if (typeof window === "undefined") return null;
  return sanitizeNextPath(new URLSearchParams(window.location.search).get("next"));
}

/** Appends `next` to a local path when it is a valid continuation. */
export function withNextPath(path: string, next: string | null | undefined): string {
  const safe = sanitizeNextPath(next);
  return safe ? `${path}${path.includes("?") ? "&" : "?"}next=${encodeURIComponent(safe)}` : path;
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
