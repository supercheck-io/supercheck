/**
 * Domain utility functions for status page subdomain routing
 *
 * Architecture:
 * - ALL subdomains except NEXT_PUBLIC_APP_URL are treated as status pages
 * - Cloudflare handles routing for specific subdomains (www, api, cdn, etc.)
 * - Simple and production-ready
 */

/**
 * Extracts the base domain from NEXT_PUBLIC_APP_URL or current window location
 * @returns The base domain (e.g., "supercheck.io" from "https://demo.supercheck.io")
 */
export function getBaseDomain(requestHostname?: string): string {
  // On client side, use the actual window location as source of truth
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    const parts = hostname.split(".");

    if (parts.length >= 2) {
      // Return the last two parts (e.g., "supercheck.io")
      return parts.slice(-2).join(".");
    }
    return hostname;
  }

  // On server side, if request hostname is provided, use it
  if (requestHostname) {
    const parts = requestHostname.split(".");
    if (parts.length >= 2) {
      return parts.slice(-2).join(".");
    }
    return requestHostname;
  }

  // Fallback to NEXT_PUBLIC_APP_URL
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  try {
    const url = new URL(appUrl);
    const hostname = url.hostname;
    const parts = hostname.split(".");

    if (parts.length >= 2) {
      return parts.slice(-2).join(".");
    }
    return hostname;
  } catch (error) {
    console.error("Invalid NEXT_PUBLIC_APP_URL:", appUrl, error);
    return "localhost";
  }
}

/**
 * Normalize a domain value by stripping protocol, port, path, and trailing dot.
 * Lightweight client-safe equivalent of normalizeStatusPageDomain() from
 * status-page-domain.ts (which depends on server-only feature-flag helpers).
 */
function normalizeDomainValue(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
  const hostname = withoutProtocol
    .split("/")[0]
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  return hostname || null;
}

/**
 * Gets the base domain specifically for status pages.
 *
 * Resolution order:
 * 1. Explicit `statusPageDomain` override (preferred for client components
 *    that obtain the domain from useAppConfig().statusPageDomain)
 * 2. STATUS_PAGE_DOMAIN environment variable (available server-side only)
 * 3. Fallback to getBaseDomain() (legacy; may strip subdomains on client)
 *
 * Client components should always pass `statusPageDomain` to avoid the
 * getBaseDomain() fallback, which only keeps the last two hostname labels
 * and therefore strips multi-level subdomains like "supercheck.example.com".
 */
export function getStatusPageBaseDomain(
  requestHostname?: string,
  statusPageDomain?: string,
): string {
  // 1. Explicit override – always preferred
  if (statusPageDomain) {
    return normalizeDomainValue(statusPageDomain) || statusPageDomain;
  }

  // 2. Server-side env var (not available in the browser)
  const envDomain = normalizeDomainValue(process.env.STATUS_PAGE_DOMAIN);
  if (envDomain) {
    return envDomain;
  }

  // 3. Legacy fallback – kept for backward compatibility
  return getBaseDomain(requestHostname);
}

/**
 * Constructs a status page hostname using the base domain.
 * @param subdomain The subdomain for the status page
 * @param requestHostname Optional hostname from the request
 * @param statusPageDomain Optional explicit domain override (from useAppConfig or getEffectiveStatusPageDomain)
 * @returns The full status page hostname
 */
export function getStatusPageHostname(
  subdomain: string,
  requestHostname?: string,
  statusPageDomain?: string,
): string {
  const baseDomain = getStatusPageBaseDomain(requestHostname, statusPageDomain);
  return `${subdomain}.${baseDomain}`;
}

/**
 * Constructs a status page URL using the base domain
 * @param subdomain The subdomain for the status page
 * @param requestHostname Optional hostname from the request
 * @param statusPageDomain Optional explicit domain override (from useAppConfig or getEffectiveStatusPageDomain)
 * @returns The full status page URL
 */
export function getStatusPageUrl(
  subdomain: string,
  requestHostname?: string,
  statusPageDomain?: string,
): string {
  const hostname = getStatusPageHostname(
    subdomain,
    requestHostname,
    statusPageDomain,
  );
  const baseDomain = getStatusPageBaseDomain(requestHostname, statusPageDomain);
  const protocol = baseDomain === "localhost" ? "http" : "https";
  return `${protocol}://${hostname}`;
}

type PublicStatusPageUrlOptions = {
  subdomain: string;
  customDomain?: string | null;
  customDomainVerified?: boolean | null;
  requestHostname?: string;
  appUrl?: string;
  /** Explicit status page domain override (from useAppConfig or getEffectiveStatusPageDomain) */
  statusPageDomain?: string;
};

function getPreferredStatusPageProtocol(appUrl?: string, statusPageDomain?: string): string {
  if (appUrl) {
    try {
      return new URL(appUrl).protocol.replace(":", "") || "https";
    } catch {
      // Fall through to environment-based inference.
    }
  }

  const baseDomain = getStatusPageBaseDomain(undefined, statusPageDomain);
  return baseDomain === "localhost" ? "http" : "https";
}

export function getPublicStatusPageUrl({
  subdomain,
  customDomain,
  customDomainVerified,
  requestHostname,
  appUrl,
  statusPageDomain,
}: PublicStatusPageUrlOptions): string {
  if (customDomainVerified && customDomain) {
    const protocol = getPreferredStatusPageProtocol(appUrl, statusPageDomain);
    const normalizedHostname = customDomain.trim().toLowerCase().replace(/\.$/, "");
    return `${protocol}://${normalizedHostname}`;
  }

  return getStatusPageUrl(subdomain, requestHostname, statusPageDomain);
}

/**
 * Extracts subdomain from a hostname
 * @param hostname The full hostname (e.g., "abc123.supercheck.io")
 * @returns The subdomain or null if not found
 */
export function extractSubdomain(hostname: string): string | null {
  if (!hostname || typeof hostname !== "string") {
    return null;
  }

  // Remove port if present (e.g., "localhost:3000" -> "localhost")
  const cleanHostname = hostname.split(":")[0];
  const parts = cleanHostname.split(".");

  // Handle localhost specially - demo.localhost has 2 parts
  if (parts.length === 2 && parts[1] === "localhost") {
    const subdomain = parts[0];
    // Validate subdomain format (alphanumeric with optional hyphens)
    return /^[a-zA-Z0-9-]{1,63}$/.test(subdomain) ? subdomain : null;
  }

  // For production domains, require 3+ parts (subdomain.example.com)
  if (parts.length >= 3) {
    const subdomain = parts[0];
    // Validate subdomain format (alphanumeric with optional hyphens, 1-63 chars per DNS spec)
    return /^[a-zA-Z0-9-]{1,63}$/.test(subdomain) ? subdomain : null;
  }

  return null;
}

/**
 * Gets the main app subdomain from NEXT_PUBLIC_APP_URL
 * @returns The main app subdomain or null if not applicable
 */
export function getMainAppSubdomain(): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  try {
    const url = new URL(appUrl);
    return extractSubdomain(url.hostname);
  } catch (error) {
    console.error("Invalid NEXT_PUBLIC_APP_URL:", appUrl, error);
    return null;
  }
}
