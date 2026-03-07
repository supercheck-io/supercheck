import { isCloudHosted } from "@/lib/feature-flags";

export const CLOUD_STATUS_PAGE_DOMAIN = "supercheck.io";

const LOCAL_STATUS_PAGE_DOMAIN = "localhost";

/**
 * Normalize a domain-like value into a canonical hostname.
 * Accepts hostnames or URL-like values (e.g. https://example.com:443/path).
 */
export function normalizeStatusPageDomain(
  value: string | undefined
): string | null {
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
 * Returns the effective status page base domain for runtime usage.
 *
 * Cloud mode always uses the canonical domain.
 * Self-hosted mode resolves in order:
 *   1. STATUS_PAGE_DOMAIN (explicit override)
 *   2. APP_DOMAIN (main app domain – common in single-domain self-hosted setups)
 *   3. APP_URL hostname (derived from the application URL)
 *   4. "localhost" (development fallback)
 */
export function getEffectiveStatusPageDomain(): string {
  if (isCloudHosted()) {
    return CLOUD_STATUS_PAGE_DOMAIN;
  }

  return (
    normalizeStatusPageDomain(process.env.STATUS_PAGE_DOMAIN) ||
    normalizeStatusPageDomain(process.env.APP_DOMAIN) ||
    normalizeStatusPageDomain(process.env.APP_URL) ||
    LOCAL_STATUS_PAGE_DOMAIN
  );
}

/**
 * The status page base domain namespace is reserved for default UUID routes
 * (e.g. <uuid>.supercheck.io). Custom domains must be outside this namespace.
 */
export function isReservedStatusPageHostname(
  hostname: string | null | undefined,
  baseDomain = getEffectiveStatusPageDomain()
): boolean {
  const normalizedHostname = normalizeStatusPageDomain(hostname ?? undefined);
  const normalizedBaseDomain = normalizeStatusPageDomain(baseDomain);

  if (!normalizedHostname || !normalizedBaseDomain) {
    return false;
  }

  return (
    normalizedHostname === normalizedBaseDomain ||
    normalizedHostname.endsWith(`.${normalizedBaseDomain}`)
  );
}
