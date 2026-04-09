import { isCloudHosted } from "@/lib/feature-flags";

export const CLOUD_STATUS_PAGE_DOMAIN = "supercheck.io";

const LOCAL_STATUS_PAGE_DOMAIN = "localhost";
const LOOPBACK_HOSTS = new Set([LOCAL_STATUS_PAGE_DOMAIN, "127.0.0.1", "::1"]);
const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;

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
 * Self-hosted mode can override via STATUS_PAGE_DOMAIN.
 */
export function getEffectiveStatusPageDomain(): string {
  if (isCloudHosted()) {
    return CLOUD_STATUS_PAGE_DOMAIN;
  }

  return (
    normalizeStatusPageDomain(process.env.STATUS_PAGE_DOMAIN) ||
    LOCAL_STATUS_PAGE_DOMAIN
  );
}

/**
 * Returns the effective CNAME target shown for custom-domain setup.
 *
 * The CNAME target is always the same as STATUS_PAGE_DOMAIN.
 * CNAME verification also accepts common prefixed variants
 * (cname.DOMAIN, ingress.DOMAIN) so users can point custom domains
 * at whichever hostname routes to the app.
 */
export function getEffectiveStatusPageCnameTarget(): string {
  return getEffectiveStatusPageDomain();
}

/**
 * Custom domains require a publicly routable hostname target.
 * Loopback hosts, raw IPs, and single-label names are deployment placeholders,
 * not valid CNAME destinations for internet-facing status pages.
 */
export function isPublicStatusPageHostname(
  hostname: string | null | undefined
): boolean {
  const normalizedHostname = normalizeStatusPageDomain(hostname ?? undefined);

  if (!normalizedHostname) {
    return false;
  }

  if (
    LOOPBACK_HOSTS.has(normalizedHostname) ||
    IPV4_PATTERN.test(normalizedHostname) ||
    normalizedHostname.includes(":") ||
    !normalizedHostname.includes(".")
  ) {
    return false;
  }

  return true;
}

export function getStatusPageCustomDomainConfigError(): string | null {
  const cnameTarget = getEffectiveStatusPageCnameTarget();

  if (isPublicStatusPageHostname(cnameTarget)) {
    return null;
  }

  return `Custom domains require a publicly reachable hostname. Set STATUS_PAGE_DOMAIN to a real DNS hostname instead of ${cnameTarget}.`;
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
