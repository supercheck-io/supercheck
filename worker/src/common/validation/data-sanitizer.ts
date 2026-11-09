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

  // Truncate first: regexes then run over at most maxLength chars, never the
  // full (up to 10MB) body. Every pattern below is also length-bounded so a
  // large maxLength cannot reintroduce quadratic backtracking.
  const truncated = body.length > maxLength;
  let head = body.substring(0, maxLength);
  if (truncated) {
    // Drop a token cut by the boundary: a partial key or email would no longer match its pattern.
    let end = head.length;
    while (end > 0 && !/[\s"'<>,;]/.test(head[end - 1])) end--;
    head = head.substring(0, end);
  }
  const sanitized = head
    // Credit card numbers (basic pattern)
    .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD-REDACTED]')
    // Social Security Numbers
    .replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, '[SSN-REDACTED]')
    // Email addresses (RFC 5321 limits: 64 local part, 255 domain)
    .replace(
      /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}\b/g,
      '[EMAIL-REDACTED]',
    )
    // API keys: long all-alphanumeric runs
    .replace(/\b[A-Za-z0-9]{32,}\b/g, '[API-KEY-REDACTED]')
    // Bearer tokens in headers
    .replace(
      /Bearer\s{1,64}[A-Za-z0-9\-._~+/]{1,2048}[A-Za-z0-9\-._~+/]*/gi,
      'Bearer [TOKEN-REDACTED]',
    )
    // Basic auth credentials
    .replace(
      /Basic\s{1,64}[A-Za-z0-9+/=]{1,2048}[A-Za-z0-9+/=]*/gi,
      'Basic [CREDENTIALS-REDACTED]',
    );

  return truncated ? sanitized + '... [TRUNCATED]' : sanitized;
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
    'proxy-authorization',
    'x-csrf-token',
    'x-xsrf-token',
    'x-access-token',
    'x-refresh-token',
    'x-session-id',
    'x-amz-security-token',
    'x-vault-token',
    'x-jwt',
    'authentication-info',
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
 * Converts an HTTP client's response headers (plain object or AxiosHeaders)
 * into a plain object with sensitive values redacted, for persisting on a
 * monitor result. Returns undefined when there are no headers.
 */
export function sanitizeResponseHeaders(
  headers: unknown,
): Record<string, string> | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const plain =
    typeof (headers as { toJSON?: unknown }).toJSON === 'function'
      ? (
          headers as { toJSON: () => Record<string, string | string[]> }
        ).toJSON()
      : (headers as Record<string, string | string[]>);
  return sanitizeHeaders(plain) as Record<string, string>;
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

// Mirrors SENSITIVE_QUERY_PARAM in app/src/lib/monitor-read-config.ts (keep in sync).
const SENSITIVE_QUERY_PARAM =
  /token|secret|passw|pwd|^pass$|api[-_]?key|app[-_]?key|access[-_]?key|private[-_]?key|client[-_]?key|[-_]key$|^key$|auth(?!or\b|ors\b|ority)|signature|^sig$|credential|session|jwt|^otp$|^sid$|ticket|^hash$|^code$|^pw$|^sk$/i;

/**
 * Redacts URL userinfo, sensitive query values and a fragment carrying values
 * so a monitor target can be shown in notifications. Non-URL targets (hosts,
 * ping/port targets) are returned unchanged.
 */
export function redactTargetUrl(target: string): string {
  // Userinfo (user:pass@host) is masked for any scheme, or none (user:pass@host:5432).
  const masked = target.replace(
    /^(\s*(?:[a-z][a-z0-9+.-]*:)?\/\/|\s*)[^/?#\s]*@/i,
    '$1REDACTED@',
  );
  let parsed: URL;
  try {
    parsed = new URL(masked.trim());
  } catch {
    // Fail closed: an unparseable http(s) string may still carry a secret query.
    return /^\s*https?:/i.test(masked) ? masked.replace(/[?#].*$/, '') : masked;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    return masked;
  const names = [...new Set(parsed.searchParams.keys())].filter((n) =>
    SENSITIVE_QUERY_PARAM.test(n),
  );
  const fragment = parsed.hash.includes('=');
  if (
    masked === target &&
    !parsed.username &&
    !parsed.password &&
    names.length === 0 &&
    !fragment
  )
    return target;
  if (parsed.username || parsed.password) parsed.username = 'REDACTED';
  parsed.password = '';
  for (const n of names) parsed.searchParams.set(n, 'REDACTED');
  if (fragment) parsed.hash = 'REDACTED';
  return parsed.toString();
}

/** Redacts every http(s) URL embedded in free text (error messages echo target URLs). */
export function redactUrlsInText(text: string): string {
  // Apostrophes may appear inside a password or query value, so they stay in the match.
  return text.replace(/https?:\/\/[^\s"<>]+/gi, (u) => {
    // Trailing prose punctuation and quotes are not part of the URL; keep them outside the redaction.
    let end = u.length;
    while (end > 0 && ").,;'`".includes(u[end - 1])) end--;
    return redactTargetUrl(u.slice(0, end)) + u.slice(end);
  });
}
