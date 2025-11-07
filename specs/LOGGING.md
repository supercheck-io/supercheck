# Logging Implementation with Pino

This document describes the comprehensive logging implementation for both the Next.js frontend and Nest.js worker services using [Pino](https://github.com/pinojs/pino).

## Overview

Both applications use **Pino** for structured, high-performance logging with the following features:

- **Structured JSON logging** in production for easy parsing and analysis
- **Pretty-printed colorized output** in development for human readability
- **Environment-aware log levels** (debug in dev, info in prod)
- **Request ID tracking** for distributed tracing
- **Error serialization** with stack traces
- **Performance metrics** and operation timing
- **Audit logging** for security-sensitive operations

## Next.js Application Logging

### Installation

The following packages are installed:

```bash
npm install pino pino-http pino-pretty
```

### Architecture

The Next.js logging is split into:

1. **Server-side logger** (`app/src/lib/logger/pino-config.ts`) - Full Pino with all features
2. **Client-side logger** (`app/src/lib/logger/client-logger.ts`) - Browser-safe console wrapper
3. **Universal logger** (`app/src/lib/logger/index.ts`) - Automatic server/client detection
4. **HTTP middleware** (`app/src/lib/logger/http-logger.ts`) - Request/response logging
5. **Backward-compatible Logger class** (`app/src/lib/logger.ts`) - Maintains existing API

### Usage Examples

#### Basic Logging

```typescript
import { logger } from '@/lib/logger';

// Simple message
logger.info('User logged in');

// With structured data
logger.info({ userId: '123', action: 'login' }, 'User logged in');

// Error logging
logger.error({ err: error, userId: '123' }, 'Login failed');

// Debug logging (only in development)
logger.debug({ query: 'SELECT * FROM users' }, 'Database query executed');
```

#### Creating Child Loggers

```typescript
import { createLogger } from '@/lib/logger';

// Create logger with context
const authLogger = createLogger({ module: 'authentication' });
authLogger.info('Auth check passed');

// All logs from this logger will include module: 'authentication'
```

#### Using the Legacy Logger Class

```typescript
import { Logger } from '@/lib/logger';

const logger = new Logger('[MyComponent]');
logger.info('Component initialized');
logger.error('Operation failed', error);
```

#### HTTP Request Logging

```typescript
import { httpLogger } from '@/lib/logger';

// In Next.js API route or middleware
export async function middleware(req: Request) {
  httpLogger(req, res);
  // Automatically logs request/response with timing
}
```

### Audit Logging

The audit logger (`app/src/lib/audit-logger.ts`) now uses Pino alongside database persistence:

```typescript
import { logAuditEvent, logAuthEvent, logSecurityEvent } from '@/lib/audit-logger';

// Log authentication event
await logAuthEvent('user-123', 'login', true, {
  ip: '192.168.1.1',
  userAgent: 'Mozilla/5.0...',
});

// Log security event
await logSecurityEvent('unauthorized_access_attempt', 'user-456', {
  resource: '/admin/users',
  method: 'GET',
});

// Generic audit event
await logAuditEvent({
  userId: 'user-123',
  action: 'data_export',
  resource: 'reports',
  resourceId: 'report-789',
  success: true,
  metadata: {
    format: 'csv',
    rowCount: 1000,
  },
});
```

### Configuration

Environment variables:

```env
# Set log level (default: 'debug' in dev, 'info' in prod)
LOG_LEVEL=debug

# Node environment
NODE_ENV=development
```

## Nest.js Worker Logging

### Installation

The following packages are installed:

```bash
npm install pino pino-pretty nestjs-pino pino-http
```

### Architecture

The Nest.js logging consists of:

1. **Logger Module** (`worker/src/logger/logger.module.ts`) - Global Pino configuration
2. **Logger Service** (`worker/src/logger/logger.service.ts`) - Convenient wrapper with helper methods
3. **Bootstrap integration** (`worker/src/main.ts`) - Application-wide logger replacement

### Usage Examples

#### Basic Service Logging

```typescript
import { Injectable } from '@nestjs/common';
import { LoggerService } from './logger/logger.service';

@Injectable()
export class ExecutionService {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(ExecutionService.name);
  }

  async executeTest(testId: string) {
    this.logger.info('Starting test execution', { testId });

    try {
      // ... execution logic
      this.logger.info('Test execution completed', {
        testId,
        status: 'success',
        duration: 1234,
      });
    } catch (error) {
      this.logger.error('Test execution failed', error, { testId });
      throw error;
    }
  }
}
```

#### Operation Timing

```typescript
const startTime = this.logger.startOperation('database-query', { query: 'SELECT ...' });

// ... perform operation

this.logger.endOperation('database-query', startTime, true, { rowCount: 100 });
```

#### Job Execution Logging

```typescript
this.logger.logJobExecution('test-execution', job.id, 'started', {
  testId: job.data.testId,
  priority: job.opts.priority,
});

// ... job processing

this.logger.logJobExecution('test-execution', job.id, 'completed', {
  testId: job.data.testId,
  duration: Date.now() - startTime,
});
```

#### API Call Logging

```typescript
const startTime = Date.now();

const response = await axios.get('https://api.example.com/data');

this.logger.logApiCall(
  'GET',
  'https://api.example.com/data',
  response.status,
  Date.now() - startTime,
  { responseSize: response.data.length }
);
```

#### Database Query Logging

```typescript
const startTime = Date.now();
const result = await db.query('SELECT * FROM tests WHERE id = ?', [testId]);
const duration = Date.now() - startTime;

this.logger.logQuery('SELECT * FROM tests WHERE id = ?', duration, {
  testId,
  rowCount: result.rows.length,
});
```

### Replacing Built-in NestJS Logger

The Pino logger automatically replaces NestJS's built-in logger. You can also use it with the standard NestJS Logger interface:

```typescript
import { Logger } from '@nestjs/common';

@Injectable()
export class MyService {
  private readonly logger = new Logger(MyService.name);

  doSomething() {
    this.logger.log('Operation started');
    this.logger.error('Operation failed', error.stack);
  }
}
```

### Configuration

Environment variables:

```env
# Set log level
LOG_LEVEL=debug

# Node environment
NODE_ENV=development

# Service port
PORT=8000
```

## Log Levels

Both applications support the following log levels (from most to least verbose):

1. **trace** - Very detailed debugging information (not used by default)
2. **debug** - Detailed debugging information (development only)
3. **info** - General informational messages
4. **warn** - Warning messages for potentially harmful situations
5. **error** - Error messages for error events
6. **fatal** - Critical errors that may cause the application to terminate

### Default Log Levels by Environment

- **Development**: `debug` and above
- **Production**: `info` and above
- **Test**: `silent` (no logs)

## Log Format

### Development (Pretty-printed)

```
14:32:15.123 INFO [auth]: User logged in
    userId: "user-123"
    action: "login"
    ip: "192.168.1.1"
```

### Production (JSON)

```json
{
  "level": "info",
  "time": "2024-01-15T14:32:15.123Z",
  "service": "supercheck-app",
  "env": "production",
  "module": "auth",
  "msg": "User logged in",
  "userId": "user-123",
  "action": "login",
  "ip": "192.168.1.1"
}
```

## Best Practices

### 1. Always Include Context

```typescript
// Good
logger.info({ userId, action, resource }, 'User action completed');

// Bad
logger.info('User action completed');
```

### 2. Use Child Loggers for Components

```typescript
const componentLogger = createLogger({ component: 'UserService' });
```

### 3. Log Errors with Error Objects

```typescript
// Good
logger.error({ err: error, userId }, 'Operation failed');

// Bad
logger.error(`Operation failed: ${error.message}`);
```

### 4. Include Timing for Operations

```typescript
const start = Date.now();
// ... operation
logger.info({ duration: Date.now() - start }, 'Operation completed');
```

### 5. Use Appropriate Log Levels

- **debug**: Internal state, variable values, flow control
- **info**: Significant events (user actions, job completions)
- **warn**: Recoverable errors, deprecated usage, configuration issues
- **error**: Unrecoverable errors, exceptions, failures
- **fatal**: Critical system failures

### 6. Sanitize Sensitive Data

```typescript
// Never log passwords, tokens, or sensitive data
logger.info({
  email: user.email,
  password: '[REDACTED]', // Good
}, 'User created');
```

### 7. Use Structured Data

```typescript
// Good - structured data is queryable
logger.info({ userId: '123', action: 'purchase', amount: 99.99 }, 'Purchase completed');

// Bad - string interpolation loses structure
logger.info(`User 123 completed purchase of $99.99`);
```

## Querying Logs in Production

### With JSON logs, you can easily filter and analyze:

```bash
# Filter by level
cat app.log | grep '"level":"error"'

# Filter by user
cat app.log | grep '"userId":"user-123"'

# Parse with jq
cat app.log | jq 'select(.level == "error")'

# Count errors by module
cat app.log | jq -r 'select(.level == "error") | .module' | sort | uniq -c
```

## Log Aggregation

For production environments, consider integrating with:

- **Datadog**: Structured JSON logs can be shipped directly
- **CloudWatch**: AWS CloudWatch Logs with log groups
- **Elasticsearch + Kibana**: ELK stack for log analysis
- **Grafana Loki**: Lightweight log aggregation
- **Papertrail**: Cloud-based log management

## Troubleshooting

### Logs not appearing

1. Check `LOG_LEVEL` environment variable
2. Verify `NODE_ENV` is set correctly
3. Ensure logger is imported correctly

### Pretty printing not working in development

1. Verify `pino-pretty` is installed
2. Check `NODE_ENV=development`
3. Ensure terminal supports colors

### Circular reference errors

Use Pino's built-in serializers:

```typescript
logger.info({ obj: pino.stdSerializers.wrap(obj) }, 'Message');
```

## Migration Guide

### From console.log

```typescript
// Before
console.log('User logged in:', userId);

// After
logger.info({ userId }, 'User logged in');
```

### From NestJS Logger

```typescript
// Before
this.logger.log('Operation started');

// After (both work)
this.logger.info('Operation started');
// or
this.loggerService.info('Operation started');
```

## Performance

Pino is one of the fastest Node.js loggers:

- **10x faster** than Winston
- **Asynchronous** by default
- **Low overhead** in production
- **Minimal CPU impact** with JSON serialization

## Further Reading

- [Pino Documentation](https://getpino.io/)
- [nestjs-pino Documentation](https://github.com/iamolegga/nestjs-pino)
- [Pino Best Practices](https://github.com/pinojs/pino/blob/master/docs/best-practices.md)
- [Structured Logging](https://github.com/pinojs/pino/blob/master/docs/api.md#logger)
