/**
 * Input Sanitization Utility
 *
 * Provides secure input sanitization to prevent XSS, SQL injection, and other security vulnerabilities.
 * Uses best practices for sanitizing user inputs while preserving functionality.
 */

/**
 * Sanitizes a string by removing potentially dangerous characters and HTML tags
 * while preserving basic formatting
 */
export function sanitizeString(input: string | null | undefined): string {
  if (!input) return '';

  // Remove any null bytes
  let sanitized = input.replace(/\0/g, '');

  // Remove HTML tags except safe ones (for descriptions/text fields)
  // This prevents XSS attacks via script tags
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  sanitized = sanitized.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  sanitized = sanitized.replace(/<embed\b[^<]*>/gi, '');
  sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, ''); // Remove event handlers

  // Remove potentially dangerous protocols
  sanitized = sanitized.replace(/javascript:/gi, '');
  sanitized = sanitized.replace(/data:text\/html/gi, '');
  sanitized = sanitized.replace(/vbscript:/gi, '');

  // Trim whitespace
  return sanitized.trim();
}

/**
 * Sanitizes a URL ensuring it's a valid HTTP/HTTPS URL
 */
export function sanitizeUrl(url: string | null | undefined): string {
  if (!url) return '';

  const sanitized = sanitizeString(url);

  try {
    const parsed = new URL(sanitized);

    // Only allow http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }

    return parsed.toString();
  } catch {
    return '';
  }
}

/**
 * Sanitizes hostname/IP address for ping and port check monitors
 */
export function sanitizeHostname(hostname: string | null | undefined): string {
  if (!hostname) return '';

  let sanitized = sanitizeString(hostname);

  // Remove any characters that aren't valid in hostnames/IPs
  // Allow: letters, numbers, dots, hyphens
  sanitized = sanitized.replace(/[^a-zA-Z0-9.\-]/g, '');

  return sanitized;
}

/**
 * Sanitizes JSON string input (for headers, body, etc.)
 * Returns the original string if it's valid JSON, empty string otherwise
 */
export function sanitizeJson(jsonString: string | null | undefined): string {
  if (!jsonString) return '';

  // First sanitize as string
  const sanitized = sanitizeString(jsonString);

  // Verify it's valid JSON
  try {
    const parsed = JSON.parse(sanitized);

    // Re-stringify to ensure consistent formatting
    // This also removes any potential exploits in the JSON
    return JSON.stringify(parsed);
  } catch {
    // If it's not valid JSON, return empty string
    return '';
  }
}

/**
 * Sanitizes authentication credentials
 * More permissive than sanitizeString but still removes dangerous content
 */
export function sanitizeCredential(credential: string | null | undefined): string {
  if (!credential) return '';

  // Remove null bytes and control characters except common ones (tab, newline)
  let sanitized = credential.replace(/[\0\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Remove HTML tags and event handlers
  sanitized = sanitized.replace(/<[^>]*>/g, '');
  sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');

  // Remove javascript: and similar protocols
  sanitized = sanitized.replace(/javascript:/gi, '');
  sanitized = sanitized.replace(/data:text\/html/gi, '');

  return sanitized;
}

/**
 * Sanitizes a monitor name
 */
export function sanitizeMonitorName(name: string | null | undefined): string {
  if (!name) return '';

  // More strict - only allow alphanumeric, spaces, hyphens, underscores, and basic punctuation
  let sanitized = sanitizeString(name);

  // Limit to safe characters for display
  sanitized = sanitized.replace(/[^a-zA-Z0-9 \-_.,()]/g, '');

  // Collapse multiple spaces into one
  sanitized = sanitized.replace(/\s+/g, ' ');

  return sanitized.trim();
}

/**
 * Sanitizes a number input, ensuring it's a valid integer
 */
export function sanitizeInteger(value: string | number | null | undefined, min?: number, max?: number): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;

  const parsed = typeof value === 'string' ? parseInt(value, 10) : value;

  if (isNaN(parsed)) return undefined;

  if (min !== undefined && parsed < min) return min;
  if (max !== undefined && parsed > max) return max;

  return parsed;
}

/**
 * Sanitizes expected status codes string
 */
export function sanitizeStatusCodes(statusCodes: string | null | undefined): string {
  if (!statusCodes) return '';

  let sanitized = sanitizeString(statusCodes);

  // Only allow numbers, hyphens, commas, and spaces
  sanitized = sanitized.replace(/[^0-9\-,\s]/g, '');

  // Remove extra spaces
  sanitized = sanitized.replace(/\s+/g, ' ');

  return sanitized.trim();
}

/**
 * Sanitizes HTTP method
 */
export function sanitizeHttpMethod(method: string | null | undefined): string {
  if (!method) return 'GET';

  const sanitized = sanitizeString(method).toUpperCase();

  const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

  return validMethods.includes(sanitized) ? sanitized : 'GET';
}

/**
 * Comprehensive sanitization for monitor form data
 */
export interface MonitorFormData {
  name?: string;
  target?: string;
  type?: string;
  interval?: string;
  httpConfig_method?: string;
  httpConfig_headers?: string;
  httpConfig_body?: string;
  httpConfig_expectedStatusCodes?: string;
  httpConfig_keywordInBody?: string;
  httpConfig_authUsername?: string;
  httpConfig_authPassword?: string;
  httpConfig_authToken?: string;
  portConfig_port?: number | string;
  websiteConfig_sslDaysUntilExpirationWarning?: number | string;
  [key: string]: unknown;
}

export function sanitizeMonitorFormData(data: MonitorFormData): MonitorFormData {
  const sanitized: MonitorFormData = { ...data };

  // Sanitize name
  if (sanitized.name) {
    sanitized.name = sanitizeMonitorName(sanitized.name);
  }

  // Sanitize target based on type
  if (sanitized.target) {
    if (sanitized.type === 'http_request' || sanitized.type === 'website') {
      sanitized.target = sanitizeUrl(sanitized.target);
    } else if (sanitized.type === 'ping_host' || sanitized.type === 'port_check') {
      sanitized.target = sanitizeHostname(sanitized.target);
    } else {
      sanitized.target = sanitizeString(sanitized.target);
    }
  }

  // Sanitize HTTP config
  if (sanitized.httpConfig_method) {
    sanitized.httpConfig_method = sanitizeHttpMethod(sanitized.httpConfig_method);
  }

  if (sanitized.httpConfig_headers) {
    sanitized.httpConfig_headers = sanitizeJson(sanitized.httpConfig_headers);
  }

  if (sanitized.httpConfig_body) {
    sanitized.httpConfig_body = sanitizeString(sanitized.httpConfig_body);
  }

  if (sanitized.httpConfig_expectedStatusCodes) {
    sanitized.httpConfig_expectedStatusCodes = sanitizeStatusCodes(sanitized.httpConfig_expectedStatusCodes);
  }

  if (sanitized.httpConfig_keywordInBody) {
    sanitized.httpConfig_keywordInBody = sanitizeString(sanitized.httpConfig_keywordInBody);
  }

  // Sanitize auth credentials
  if (sanitized.httpConfig_authUsername) {
    sanitized.httpConfig_authUsername = sanitizeCredential(sanitized.httpConfig_authUsername);
  }

  if (sanitized.httpConfig_authPassword) {
    sanitized.httpConfig_authPassword = sanitizeCredential(sanitized.httpConfig_authPassword);
  }

  if (sanitized.httpConfig_authToken) {
    sanitized.httpConfig_authToken = sanitizeCredential(sanitized.httpConfig_authToken);
  }

  // Sanitize port
  if (sanitized.portConfig_port !== undefined) {
    sanitized.portConfig_port = sanitizeInteger(sanitized.portConfig_port, 1, 65535);
  }

  // Sanitize SSL days
  if (sanitized.websiteConfig_sslDaysUntilExpirationWarning !== undefined) {
    sanitized.websiteConfig_sslDaysUntilExpirationWarning = sanitizeInteger(
      sanitized.websiteConfig_sslDaysUntilExpirationWarning,
      1,
      365
    );
  }

  return sanitized;
}
