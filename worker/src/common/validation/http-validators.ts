/**
 * HTTP validation utilities
 * Provides functions to validate HTTP status codes, methods, and responses
 */

/**
 * Checks if status code matches the expected pattern
 * Supports patterns like:
 * - "2xx", "3xx", "4xx", "5xx" (wildcard patterns)
 * - "200-299" (ranges)
 * - "200,404,500" (comma-separated values)
 * - "200" (specific codes)
 */
export function isExpectedStatus(
  actualStatus: number,
  expectedCodesString?: string,
): boolean {
  if (!expectedCodesString || expectedCodesString.trim() === '') {
    // Default to 2xx if no specific codes are provided
    return actualStatus >= 200 && actualStatus < 300;
  }

  const parts = expectedCodesString.split(',').map((part) => part.trim());

  for (const part of parts) {
    // Handle patterns like "2xx", "3xx", "4xx", "5xx"
    if (part.endsWith('xx')) {
      const prefix = parseInt(part.charAt(0));
      const actualPrefix = Math.floor(actualStatus / 100);
      if (actualPrefix === prefix) {
        return true;
      }
    }
    // Handle ranges like "200-299"
    else if (part.includes('-')) {
      const [min, max] = part.split('-').map(Number);
      if (actualStatus >= min && actualStatus <= max) {
        return true;
      }
    }
    // Handle specific status codes like "200", "404"
    else if (Number(part) === actualStatus) {
      return true;
    }
  }

  return false;
}

/**
 * Validates HTTP method
 * Ensures method is one of the standard HTTP methods
 */
export function isValidHttpMethod(method: string): boolean {
  const validMethods = [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
    'OPTIONS',
  ];
  return validMethods.includes(method.toUpperCase());
}

/**
 * Checks if HTTP method supports request body
 */
export function methodSupportsBody(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

/**
 * Gets appropriate default status codes for a monitor type
 */
export function getDefaultExpectedStatusCodes(monitorType: string): string {
  switch (monitorType) {
    case 'website':
      return '200-299'; // Only successful responses for websites
    case 'http_request':
      return '200-299,300-399'; // Allow redirects for general HTTP requests
    default:
      return '200-299';
  }
}

/**
 * Determines if a status code represents a successful response
 */
export function isSuccessStatus(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

/**
 * Determines if a status code represents a redirect
 */
export function isRedirectStatus(statusCode: number): boolean {
  return statusCode >= 300 && statusCode < 400;
}

/**
 * Determines if a status code represents a client error
 */
export function isClientErrorStatus(statusCode: number): boolean {
  return statusCode >= 400 && statusCode < 500;
}

/**
 * Determines if a status code represents a server error
 */
export function isServerErrorStatus(statusCode: number): boolean {
  return statusCode >= 500 && statusCode < 600;
}

/**
 * Gets a human-readable description of the status code category
 */
export function getStatusCategory(statusCode: number): string {
  if (isSuccessStatus(statusCode)) return 'Success';
  if (isRedirectStatus(statusCode)) return 'Redirect';
  if (isClientErrorStatus(statusCode)) return 'Client Error';
  if (isServerErrorStatus(statusCode)) return 'Server Error';
  return 'Unknown';
}
