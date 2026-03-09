import { isCloudHosted } from "@/lib/feature-flags";
import { normalizeHostname } from "@/lib/domain-utils";

export const CLOUD_STATUS_PAGE_DOMAIN = "supercheck.io";
const LOCAL_APP_URL = "http://localhost:3000";

const LOCAL_STATUS_PAGE_DOMAIN = "localhost";

export type StatusPageRouteMode = "subdomain" | "path";

/**
 * Normalize a domain-like value into a canonical hostname.
 *
 * Re-exports the shared `normalizeHostname` from domain-utils under the
 * legacy name so existing callers (verify-status-page-domain.ts, etc.)
 * continue to work without changes.
 */
export const normalizeStatusPageDomain = (
  value: string | undefined
): string | null => normalizeHostname(value);

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
 * Returns how default public status page URLs should be generated.
 *
 * Cloud always uses wildcard subdomains (`<uuid>.supercheck.io`).
 * Self-hosted defaults to path routing (`/status/<uuid>`) unless the operator
 * explicitly configures `STATUS_PAGE_DOMAIN`, which opts into wildcard DNS.
 */
export function getStatusPageRouteMode(): StatusPageRouteMode {
  if (isCloudHosted()) {
    return "subdomain";
  }

  return normalizeStatusPageDomain(process.env.STATUS_PAGE_DOMAIN)
    ? "subdomain"
    : "path";
}

/**
 * Returns the canonical application origin used for path-based public URLs.
 */
export function getEffectiveAppUrl(): string {
  const configuredAppUrl =
    process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || LOCAL_APP_URL;

  try {
    return new URL(configuredAppUrl).origin;
  } catch {
    return LOCAL_APP_URL;
  }
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
