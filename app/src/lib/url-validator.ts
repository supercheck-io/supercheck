/**
 * URL Validation Utilities for SSRF Protection
 * 
 * Provides validation functions to prevent Server-Side Request Forgery (SSRF) attacks
 * by blocking requests to private/internal networks.
 */

import { isMetadataOrLinkLocalAddress } from "@/lib/sre/connectors/endpoint-policy";
import { isSelfHosted } from "@/lib/feature-flags";
import { isPrivateOrReservedAddress } from "./outbound-address-policy";

/**
 * Self-hosted installs that set ALLOW_INTERNAL_TARGETS=true (exactly) may point webhook channels at
 * private hosts and plain http, as monitors may. Cloud never does, and metadata/link-local stay blocked.
 */
export function allowInternalWebhookTargets(): boolean {
  return isSelfHosted() && process.env.ALLOW_INTERNAL_TARGETS === "true";
}

function isMetadataHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  return (
    isMetadataOrLinkLocalAddress(normalized) ||
    /^metadata\.(google|azure)\.internal$/.test(normalized)
  );
}

// Private IP ranges that should not be accessible via webhooks
const PRIVATE_IP_PATTERNS = [
  // Loopback
  /^127\./,
  /^::1$/,
  /^localhost$/i,
  // Private Class A
  /^10\./,
  // Private Class B
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  // Private Class C
  /^192\.168\./,
  // Link-local
  /^169\.254\./,
  // IPv6 private
  /^fc00:/i,
  /^fd00:/i,
  /^fe80:/i,
  /^2001:(?:0|0000):/i, // Teredo
  /^2002:/i, // 6to4
  /^64:ff9b:/i, // NAT64 well-known prefix
  // AWS/Cloud metadata endpoints
  /^169\.254\.169\.254$/,
  /^metadata\.google\.internal$/i,
  /^metadata\.azure\.internal$/i,
];

// Blocked hostnames
const BLOCKED_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
];

/**
 * Check if a hostname resolves to a private/internal IP address
 */
export function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (isPrivateOrReservedAddress(normalized)) {
    return true;
  }

  // Check against blocked hostnames
  if (BLOCKED_HOSTNAMES.includes(normalized)) {
    return true;
  }

  // Check against private IP patterns
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate if a URL is safe for webhook/external requests
 * 
 * @param url - The URL to validate
 * @returns true if the URL is safe, false otherwise
 */
export function isValidWebhookUrl(
  url: URL,
  options: { allowInternal?: boolean } = {},
): { valid: boolean; error?: string } {
  const { allowInternal = false } = options;
  // Public webhooks use the pinned TLS transport in every environment.
  if (url.protocol !== 'https:' && !(allowInternal && url.protocol === 'http:')) {
    return { valid: false, error: 'Webhook URL must use HTTPS' };
  }

  // Check for private/internal hosts
  if (allowInternal ? isMetadataHost(url.hostname) : isPrivateHost(url.hostname)) {
    return { valid: false, error: 'Cannot connect to private or internal networks' };
  }

  // Block URLs with credentials
  if (url.username || url.password) {
    return { valid: false, error: 'URLs with embedded credentials are not allowed' };
  }

  return { valid: true };
}

/**
 * Validate and sanitize a webhook URL string
 * 
 * @param urlString - The URL string to validate
 * @returns Validation result with optional error message
 */
export function validateWebhookUrlString(
  urlString: string,
  options: { allowInternal?: boolean } = {},
): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    return isValidWebhookUrl(url, options);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}
