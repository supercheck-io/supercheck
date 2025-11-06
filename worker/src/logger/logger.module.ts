/**
 * Logger Module for Nest.js Worker Service
 *
 * Provides application-wide Pino logging with:
 * - Environment-based log levels
 * - Structured JSON logging in production
 * - Pretty printing in development
 * - Request/correlation ID tracking
 * - Automatic context injection
 */

import { Module, Global } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { LoggerService } from './logger.service';

@Global()
@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        // Customize log levels based on environment
        level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),

        // Transport configuration
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  translateTime: 'HH:MM:ss.l',
                  ignore: 'pid,hostname',
                  singleLine: false,
                  messageFormat: '{levelLabel} [{context}] {msg}',
                },
              }
            : undefined,

        // Serialize errors properly
        serializers: {
          req: (req) => ({
            id: req.id,
            method: req.method,
            url: req.url,
            // Redact sensitive headers
            headers: {
              ...req.headers,
              authorization: req.headers.authorization ? '[REDACTED]' : undefined,
              cookie: req.headers.cookie ? '[REDACTED]' : undefined,
            },
          }),
          res: (res) => ({
            statusCode: res.statusCode,
          }),
          err: (err) => ({
            type: err.type,
            message: err.message,
            stack: err.stack,
          }),
        },

        // Base context for all logs
        base: {
          env: process.env.NODE_ENV || 'development',
          service: 'supercheck-worker',
        },

        // Format timestamp
        timestamp: () => `,"time":"${new Date().toISOString()}"`,

        // Format log levels
        formatters: {
          level: (label) => {
            return { level: label };
          },
        },

        // Auto-logging for HTTP requests
        autoLogging: {
          ignore: (req) => {
            // Don't log health check endpoints
            return req.url === '/health' || req.url === '/api/health';
          },
        },

        // Customize log level based on response status
        customLogLevel: (req, res, err) => {
          if (res.statusCode >= 500 || err) {
            return 'error';
          }
          if (res.statusCode >= 400) {
            return 'warn';
          }
          return 'info';
        },

        // Custom success message
        customSuccessMessage: (req, res) => {
          return `${req.method} ${req.url} completed with status ${res.statusCode}`;
        },

        // Custom error message
        customErrorMessage: (req, res, err) => {
          return `${req.method} ${req.url} failed: ${err.message}`;
        },
      },
    }),
  ],
  providers: [LoggerService],
  exports: [PinoLoggerModule, LoggerService],
})
export class LoggerModule {}
