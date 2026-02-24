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
