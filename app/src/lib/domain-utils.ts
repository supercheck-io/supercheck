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
 * Gets the base domain specifically for status pages
 * This uses the STATUS_PAGE_BASE_DOMAIN environment variable if available,
 * otherwise falls back to the standard base domain detection
 */
export function getStatusPageBaseDomain(requestHostname?: string): string {
  if (process.env.STATUS_PAGE_BASE_DOMAIN) {
    return process.env.STATUS_PAGE_BASE_DOMAIN;
  }

  if (requestHostname) {
    const parts = requestHostname.split(".");
    if (parts.length >= 2) {
      return parts.slice(-2).join(".");
    }
    return requestHostname;
  }

  return getBaseDomain();
}

/**
 * Constructs a status page URL using the base domain
 * @param subdomain The subdomain for the status page
 * @param requestHostname Optional hostname from the request
 * @returns The full status page URL
 */
export function getStatusPageUrl(
  subdomain: string,
  requestHostname?: string
): string {
  const baseDomain = getStatusPageBaseDomain(requestHostname);
  const protocol = baseDomain === "localhost" ? "http" : "https";
  return `${protocol}://${subdomain}.${baseDomain}`;
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
