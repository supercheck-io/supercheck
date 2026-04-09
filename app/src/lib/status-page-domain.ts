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
 * User-facing configuration is driven by STATUS_PAGE_DOMAIN only.
 * In self-hosted deployments, we derive a stable custom-domain target from it
 * (`cname.STATUS_PAGE_DOMAIN`) when the reserved namespace differs from the
 * main app hostname. This keeps the supported env surface small while matching
 * the DNS layout used by the HTTPS Compose/K8s examples.
 *
 * STATUS_PAGE_CNAME_TARGET remains as an undocumented compatibility fallback
 * for deployments that already started using it before this was simplified.
 */
export function getEffectiveStatusPageCnameTarget(): string {
  const compatibilityTarget = normalizeStatusPageDomain(
    process.env.STATUS_PAGE_CNAME_TARGET
  );

  if (compatibilityTarget) {
    return compatibilityTarget;
  }

  const baseDomain = getEffectiveStatusPageDomain();

  if (isCloudHosted()) {
    return baseDomain;
  }

  if (!isPublicStatusPageHostname(baseDomain)) {
    return baseDomain;
  }

  const appHostname = normalizeStatusPageDomain(
    process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
  );

  if (
    appHostname === baseDomain ||
    baseDomain.startsWith("cname.") ||
    baseDomain.startsWith("ingress.")
  ) {
    return baseDomain;
  }

  return `cname.${baseDomain}`;
}

/**
 * Returns all CNAME targets accepted during custom-domain verification.
 *
 * The UI should display getEffectiveStatusPageCnameTarget() as the primary
 * value to use. Legacy/self-managed deployments may still rely on the
 * reserved base domain or common prefixed hostnames.
 */
export function getStatusPageDomainVerificationTargets(): string[] {
  const baseDomain = getEffectiveStatusPageDomain();
  const cnameTarget = getEffectiveStatusPageCnameTarget();

  return Array.from(
    new Set([
      cnameTarget,
      baseDomain,
      `cname.${baseDomain}`,
      `ingress.${baseDomain}`,
    ])
  );
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
