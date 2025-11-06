/**
 * HTTP Request Logger Middleware
 *
 * Provides automatic HTTP request/response logging using Pino HTTP.
 * Features:
 * - Request ID generation and tracking
 * - Response time measurement
 * - Error logging
 * - Custom serializers for sensitive data
 */

import pinoHttp, { type HttpLogger } from 'pino-http';
import pino from 'pino';
import { logger } from './pino-config';
import { randomUUID } from 'crypto';

/**
 * Custom serializer to exclude sensitive headers
 */
function reqSerializer(req: unknown) {
  const request = req as { headers?: Record<string, unknown> };
  if (!request.headers) return req;

  const sanitizedHeaders = { ...request.headers };

  // Remove sensitive headers
  const sensitiveHeaders = [
    'authorization',
    'cookie',
    'x-api-key',
    'x-auth-token',
  ];

  sensitiveHeaders.forEach(header => {
    if (sanitizedHeaders[header]) {
      sanitizedHeaders[header] = '[REDACTED]';
    }
  });

  return {
    ...request,
    headers: sanitizedHeaders,
  };
}

/**
 * Create HTTP logger instance
 */
export const httpLogger: HttpLogger = pinoHttp({
  logger,

  // Generate unique request ID
  genReqId: (req, res) => {
    // Check if request ID already exists in headers
    const existingId = req.headers['x-request-id'];
    if (existingId && typeof existingId === 'string') {
      return existingId;
    }

    // Generate new request ID
    const requestId = randomUUID();
    res.setHeader('x-request-id', requestId);
    return requestId;
  },

  // Custom serializers
  serializers: {
    req: reqSerializer,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
  },

  // Customize log level based on response status
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) {
      return 'error';
    }
    if (res.statusCode >= 400) {
      return 'warn';
    }
    if (res.statusCode >= 300) {
      return 'info';
    }
    return 'info';
  },

  // Custom success message
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} completed with ${res.statusCode}`;
  },

  // Custom error message
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} failed with ${res.statusCode}: ${err.message}`;
  },

  // Custom attribute keys for request/response
  customAttributeKeys: {
    req: 'request',
    res: 'response',
    err: 'error',
    responseTime: 'duration',
  },

  // Don't automatically log - we'll do it selectively
  autoLogging: {
    ignore: (req) => {
      // Don't log health check endpoints
      if (req.url && (req.url === '/api/health' || req.url === '/health')) {
        return true;
      }
      return false;
    },
  },
});

/**
 * Express/Next.js compatible middleware
 */
export function createHttpLoggerMiddleware() {
  return httpLogger;
}

export default httpLogger;
