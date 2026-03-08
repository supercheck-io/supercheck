/**
 * Client-safe domain utility functions for status page URL generation.
 *
 * These functions are safe to import in both server and client (browser) code.
 * They deliberately avoid importing server-only modules like feature-flags.
 *
 * The canonical status page domain is resolved server-side by
 * `getEffectiveStatusPageDomain()` in status-page-domain.ts and served to the
 * client via `/api/config/app` → `useAppConfig().statusPageDomain`.
 *
 * All public URL builders require an explicit `statusPageDomain` parameter so
 * they never fall back to guessing from `window.location` or env vars.
 */

/**
 * Normalize a hostname or URL-like value to a canonical lowercase hostname.
 * Strips protocol, port, path, and trailing dot.
 *
 * Shared across client and server code – also used by settings-tab.tsx for
 * reserved-domain checks.
 */
export function normalizeHostname(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
  const hostname = withoutProtocol
    .split("/")[0]
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");

  return hostname || null;
}

/**
 * Client-safe check: is `hostname` the status page base domain or one of its
 * subdomains?  Mirrors `isReservedStatusPageHostname` from status-page-domain.ts
 * but works in the browser without importing server-only modules.
 */
export function isReservedStatusPageHostnameClient(
  hostname: string | null | undefined,
  statusPageDomain: string
): boolean {
  const normalizedHostname = normalizeHostname(hostname ?? undefined);
  const normalizedBaseDomain = normalizeHostname(statusPageDomain);

  if (!normalizedHostname || !normalizedBaseDomain) {
    return false;
  }

  return (
    normalizedHostname === normalizedBaseDomain ||
    normalizedHostname.endsWith(`.${normalizedBaseDomain}`)
  );
}

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------

/**
 * Constructs a status page URL: `https://<subdomain>.<statusPageDomain>`.
 *
 * `statusPageDomain` must be provided explicitly by callers (from the server
 * config API or env vars).  There is intentionally no browser-based fallback
 * to avoid generating links using the wrong domain.
 */
export function getStatusPageUrl(
  subdomain: string,
  statusPageDomain: string
): string {
  const baseDomain = normalizeHostname(statusPageDomain) || "localhost";
  const protocol = baseDomain === "localhost" ? "http" : "https";
  return `${protocol}://${subdomain}.${baseDomain}`;
}

type PublicStatusPageUrlOptions = {
  subdomain: string;
  customDomain?: string | null;
  customDomainVerified?: boolean | null;
  /** The authoritative status page base domain (required). */
  statusPageDomain?: string;
  /** Used only for protocol inference (http vs https). */
  appUrl?: string;
};

function getPreferredProtocol(
  appUrl?: string,
  statusPageDomain?: string
): string {
  if (appUrl) {
    try {
      return new URL(appUrl).protocol.replace(":", "") || "https";
    } catch {
      // Fall through
    }
  }

  const baseDomain = normalizeHostname(statusPageDomain);
  return baseDomain === "localhost" ? "http" : "https";
}

/**
 * Returns the public URL for a status page, preferring verified custom domains.
 */
export function getPublicStatusPageUrl({
  subdomain,
  customDomain,
  customDomainVerified,
  statusPageDomain,
  appUrl,
}: PublicStatusPageUrlOptions): string {
  if (customDomainVerified && customDomain) {
    const protocol = getPreferredProtocol(appUrl, statusPageDomain);
    const normalized = normalizeHostname(customDomain) || customDomain.trim().toLowerCase();
    return `${protocol}://${normalized}`;
  }

  return getStatusPageUrl(subdomain, statusPageDomain || "localhost");
}
