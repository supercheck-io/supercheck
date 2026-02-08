/**
 * Data sanitization utilities
 * Provides functions to safely sanitize and redact sensitive information
 * from response bodies, logs, and other data
 */

import { MEMORY_LIMITS } from '../constants';

/**
 * Masks credentials for safe logging
 * Shows first 2 and last 2 characters, masks the middle
 */
export function maskCredentials(value: string): string {
  if (!value || value.length <= 4) return '***';
  return (
    value.substring(0, 2) +
    '*'.repeat(value.length - 4) +
    value.substring(value.length - 2)
  );
}

/**
 * Sanitizes response body by removing potentially sensitive information
 * Redacts credit cards, SSNs, emails, and truncates to prevent memory issues
 */
export function sanitizeResponseBody(
  body: string,
  maxLength: number = MEMORY_LIMITS.RESPONSE_BODY_SNIPPET_LENGTH,
): string {
  if (!body) return '';

  // Remove potentially sensitive patterns
  let sanitized = body
    // Credit card numbers (basic pattern)
    .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD-REDACTED]')
    // Social Security Numbers
    .replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, '[SSN-REDACTED]')
    // Email addresses
    .replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      '[EMAIL-REDACTED]',
    )
    // API keys (common patterns)
    .replace(/\b[A-Za-z0-9]{32,}\b/g, (match) => {
      // Only redact if it looks like an API key (all alphanumeric, long)
      if (/^[A-Za-z0-9]+$/.test(match) && match.length >= 32) {
        return '[API-KEY-REDACTED]';
      }
      return match;
    })
    // Bearer tokens in headers
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+/gi, 'Bearer [TOKEN-REDACTED]')
    // Basic auth credentials
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [CREDENTIALS-REDACTED]');

  // Truncate to prevent memory issues
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength) + '... [TRUNCATED]';
  }

  return sanitized;
}

/**
 * Sanitizes headers for logging
 * Removes or masks sensitive headers like Authorization, Cookie, etc.
 */
export function sanitizeHeaders(
  headers: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const sensitiveHeaders = [
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'api-key',
    'x-auth-token',
  ];

  const sanitized: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveHeaders.includes(lowerKey)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Safely extracts error message from unknown error
 * Prevents sensitive information from leaking through error messages
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Sanitizes log data before outputting
 * Recursively processes objects to remove sensitive data
 */
export function sanitizeLogData(data: unknown, depth: number = 0): unknown {
  // Prevent infinite recursion
  if (depth > 5) {
    return '[MAX_DEPTH_EXCEEDED]';
  }

  if (data === null || data === undefined) {
    return data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map((item: unknown) => sanitizeLogData(item, depth + 1));
  }

  // Handle objects
  if (typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = [
      'password',
      'token',
      'secret',
      'apiKey',
      'api_key',
      'accessToken',
      'refreshToken',
      'authorization',
      'cookie',
    ];

    for (const [key, value] of Object.entries(
      data as Record<string, unknown>,
    )) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeLogData(value, depth + 1);
      }
    }

    return sanitized;
  }

  // Handle strings that might contain sensitive data
  if (typeof data === 'string') {
    // If string is very long, it might contain sensitive data, truncate
    if (data.length > MEMORY_LIMITS.MAX_SANITIZED_RESPONSE_LENGTH) {
      return data.substring(0, 1000) + '... [TRUNCATED]';
    }
  }

  return data;
}
