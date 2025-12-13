/**
 * URL Validation Utilities for SSRF Protection
 * 
 * Provides validation functions to prevent Server-Side Request Forgery (SSRF) attacks
 * by blocking requests to private/internal networks.
 */

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
  // Check against blocked hostnames
  if (BLOCKED_HOSTNAMES.includes(hostname.toLowerCase())) {
    return true;
  }

  // Check against private IP patterns
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
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
export function isValidWebhookUrl(url: URL): { valid: boolean; error?: string } {
  // Require HTTPS for webhooks (except in development)
  const isDevelopment = process.env.NODE_ENV === 'development';
  if (!isDevelopment && url.protocol !== 'https:') {
    return { valid: false, error: 'Webhook URL must use HTTPS' };
  }

  // Allow http only in development
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { valid: false, error: 'Invalid protocol - only HTTP(S) allowed' };
  }

  // Check for private/internal hosts
  if (isPrivateHost(url.hostname)) {
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
export function validateWebhookUrlString(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    return isValidWebhookUrl(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}
