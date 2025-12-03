# Resilience Patterns Specification

> **Version**: 1.2.0  
> **Last Updated**: 2025-12-03  
> **Status**: Production Ready

## Overview

SuperCheck implements several resilience patterns to ensure high availability, fault tolerance, and graceful degradation under failure conditions. This document covers:

1. **Queue Alerting System** - Monitoring BullMQ queue health with alerts
2. **API Key Rate Limiting** - Protecting the system from abuse
3. **Retry Logic** - Robust retry handling for transient failures

> **Note**: Database backups are managed by **PlanetScale** with automated backups and point-in-time recovery (PITR). No self-managed backup solution is required.

---

## 1. Queue Alerting System

### 1.1 Overview

The queue alerting system monitors BullMQ queues for:

- **Queue Depth**: Number of waiting jobs
- **Wait Time**: How long jobs wait before processing
- **Failure Rate**: Percentage of failed jobs
- **Processing Time**: Average time to process jobs
- **Stalled Jobs**: Jobs stuck without progress

### 1.2 Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   BullMQ        │────▶│  Queue Alerting │────▶│   Slack/Webhook │
│   Queues        │     │  Service        │     │   Notifications │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │   REST API      │
                        │   /metrics      │
                        │   /alerts       │
                        └─────────────────┘
```

### 1.3 Implementation Location

**Files**:

- `/worker/src/queue-alerting/queue-alerting.service.ts`
- `/worker/src/queue-alerting/queue-alerting.controller.ts`
- `/worker/src/queue-alerting/queue-alerting.types.ts`
- `/worker/src/queue-alerting/queue-alerting.module.ts`

### 1.4 Monitored Queues

All system queues are monitored:

| Queue Name              | Description                    |
| ----------------------- | ------------------------------ |
| `playwright-global`     | Playwright test execution jobs |
| `k6-global`             | K6 performance test jobs       |
| `k6-job-scheduler`      | K6 job scheduling              |
| `k6-job-execution`      | K6 job execution               |
| `monitor-global`        | Monitor execution jobs         |
| `monitor-scheduler`     | Monitor scheduling jobs        |
| `monitor-us-east`       | US East region monitors        |
| `monitor-eu-central`    | EU Central region monitors     |
| `monitor-asia-pacific`  | Asia Pacific region monitors   |
| `job-scheduler`         | General job scheduling         |
| `job-execution`         | General job execution          |
| `email-template-render` | Email template rendering       |

### 1.5 Alert Types

Based on job max execution time of 1 hour and test timeout of 5 minutes:

| Alert Type             | Description           | Default Warning | Default Critical |
| ---------------------- | --------------------- | --------------- | ---------------- |
| `QUEUE_DEPTH_HIGH`     | Too many waiting jobs | 70% of max      | 90% of max       |
| `WAIT_TIME_HIGH`       | Jobs waiting too long | 15 minutes      | 45 minutes       |
| `FAILURE_RATE_HIGH`    | High job failure rate | 5%              | 15%              |
| `PROCESSING_TIME_HIGH` | Jobs taking too long  | 15 minutes      | 30 minutes       |
| `QUEUE_STALLED`        | Jobs not progressing  | -               | -                |

### 1.6 Alert Recipients Configuration

Alerts can be sent via multiple channels:

#### Slack (Recommended for team notifications)

Set `QUEUE_ALERT_SLACK_WEBHOOK_URL` to your Slack Incoming Webhook URL.

1. Go to https://api.slack.com/messaging/webhooks
2. Create a new webhook for your channel (e.g., `#ops-alerts`)
3. Copy the webhook URL and set the env var

#### Custom Webhook (For integration with PagerDuty, Opsgenie, etc.)

Set `QUEUE_ALERT_WEBHOOK_URL` to receive JSON POST requests with alert data.
The payload format is:

```json
{
  "type": "queue_alert",
  "alert": {
    "id": "alert-123",
    "queueName": "playwright-global",
    "alertType": "QUEUE_DEPTH_HIGH",
    "severity": "critical",
    "message": "Queue depth at 95% (9500/10000 jobs)",
    "currentValue": 95,
    "threshold": 90,
    "timestamp": "2025-12-03T15:30:00Z"
  }
}
```

#### Email (Future enhancement)

Set `QUEUE_ALERT_EMAILS` to a comma-separated list of email addresses.
Requires email service integration (not yet implemented).

### 1.7 Configuration

#### Environment Variables

| Variable                            | Description             | Default   |
| ----------------------------------- | ----------------------- | --------- |
| `QUEUE_ALERTING_ENABLED`            | Enable/disable alerting | `true`    |
| `QUEUE_ALERTING_CHECK_INTERVAL_MS`  | Check interval          | `60000`   |
| `QUEUE_DEPTH_WARNING_THRESHOLD`     | Depth warning %         | `70`      |
| `QUEUE_DEPTH_CRITICAL_THRESHOLD`    | Depth critical %        | `90`      |
| `MAX_QUEUE_DEPTH`                   | Max queue depth         | `10000`   |
| `QUEUE_WAIT_TIME_WARNING_MS`        | Wait time warning       | `900000`  |
| `QUEUE_WAIT_TIME_CRITICAL_MS`       | Wait time critical      | `2700000` |
| `QUEUE_FAILURE_RATE_WARNING`        | Failure rate warning %  | `5`       |
| `QUEUE_FAILURE_RATE_CRITICAL`       | Failure rate critical % | `15`      |
| `QUEUE_PROCESSING_TIME_WARNING_MS`  | Processing warning      | `900000`  |
| `QUEUE_PROCESSING_TIME_CRITICAL_MS` | Processing critical     | `1800000` |
| `QUEUE_ALERT_SLACK_WEBHOOK_URL`     | Slack webhook URL       | -         |
| `QUEUE_ALERT_WEBHOOK_URL`           | Custom webhook URL      | -         |
| `QUEUE_ALERT_COOLDOWN_MS`           | Alert cooldown period   | `900000`  |

### 1.8 Slack Notification Format

When `QUEUE_ALERT_SLACK_WEBHOOK_URL` is configured, alerts are sent as rich Slack messages:

```
🚨 Queue Alert: playwright-global

Type: QUEUE_DEPTH_HIGH
Severity: CRITICAL
Message: Queue depth at 95% (9500/10000 jobs)

Threshold: 90%
Current Value: 95.00%
Time: 2025-12-03T15:30:00Z
```

### 1.9 REST API Endpoints

#### GET `/queue-alerting/metrics`

Returns current metrics for all monitored queues:

```json
{
  "queues": {
    "playwright-global": {
      "name": "playwright-global",
      "waiting": 150,
      "active": 5,
      "completed": 10000,
      "failed": 50,
      "failureRate": 0.5,
      "timestamp": "2025-12-03T15:30:00Z"
    }
  },
  "timestamp": "2025-12-03T15:30:00Z"
}
```

#### GET `/queue-alerting/alerts`

Returns active and historical alerts:

```json
{
  "active": [
    {
      "id": "alert-123",
      "queueName": "playwright-global",
      "alertType": "WAIT_TIME_HIGH",
      "severity": "warning",
      "message": "Average wait time: 16 minutes",
      "resolved": false
    }
  ],
  "history": [...],
  "timestamp": "2025-12-03T15:30:00Z"
}
```

#### GET `/queue-alerting/config`

Returns current alerting configuration (for debugging).

### 1.10 Alert Lifecycle

1. **Detection**: Service checks queue metrics every `checkIntervalMs`
2. **Threshold Check**: Compares metrics against configured thresholds
3. **Alert Creation**: Creates alert with unique ID and severity
4. **Cooldown**: Same alert type won't fire again until cooldown expires
5. **Notification**: Sends to configured channels (Slack, webhook)
6. **Resolution**: Marks alert resolved when metric returns to normal

---

## 2. API Key Rate Limiting

### 2.1 Overview

API key rate limiting protects the system from abuse by:

- Tracking request counts per API key
- Using sliding window algorithm for fair rate limiting
- Supporting per-key custom limits
- Integrating with Redis for distributed counting

### 2.2 Implementation Location

**File**: `/app/src/lib/api-key-rate-limiter.ts`

### 2.3 How It Works

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│  API        │────▶│  Rate Limiter   │────▶│   Redis     │
│  Request    │     │  Middleware     │     │   Counter   │
└─────────────┘     └────────┬────────┘     └─────────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
                    ▼                 ▼
              ┌──────────┐      ┌──────────┐
              │ Allowed  │      │ Rejected │
              │ (200 OK) │      │ (429)    │
              └──────────┘      └──────────┘
```

### 2.4 Database Schema

Rate limiting configuration is stored per API key:

```sql
-- In apikey table
rateLimitEnabled BOOLEAN DEFAULT true,
rateLimitTimeWindow INTEGER DEFAULT 60,  -- seconds
rateLimitMax INTEGER DEFAULT 100         -- requests per window
```

### 2.5 Algorithm: Sliding Window

```typescript
// Simplified sliding window implementation
async checkRateLimit(apiKeyId: string, config: RateLimitConfig) {
  const key = `ratelimit:${apiKeyId}`;
  const now = Date.now();
  const windowStart = now - (config.timeWindowSeconds * 1000);

  // Remove old entries outside the window
  await redis.zremrangebyscore(key, 0, windowStart);

  // Count current requests in window
  const count = await redis.zcard(key);

  if (count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: windowStart + config.timeWindowSeconds * 1000 };
  }

  // Add current request
  await redis.zadd(key, now, `${now}-${Math.random()}`);
  await redis.expire(key, config.timeWindowSeconds);

  return { allowed: true, remaining: config.maxRequests - count - 1 };
}
```

### 2.6 Integration

Rate limiting is applied in the job trigger route:

```typescript
// In /api/jobs/[id]/trigger/route.ts
const rateLimitResult = await apiKeyRateLimiter.checkRateLimit(apiKey.id, {
  enabled: apiKey.rateLimitEnabled,
  timeWindowSeconds: apiKey.rateLimitTimeWindow,
  maxRequests: apiKey.rateLimitMax,
});

if (!rateLimitResult.allowed) {
  return NextResponse.json(
    {
      error: "Rate limit exceeded",
      retryAfter: rateLimitResult.resetAt,
    },
    { status: 429 }
  );
}
```

### 2.7 Response Headers

When rate limiting is active, responses include:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1701619260
```

---

## 3. Retry Logic

### 3.1 Overview

Retry logic provides fault tolerance for transient failures:

- Exponential backoff with jitter
- Configurable retry limits
- Error classification (retryable vs non-retryable)
- Timeout handling

### 3.2 Implementation Location

**File**: `/worker/src/common/utils/retry.util.ts`

### 3.3 Configuration

```typescript
interface RetryOptions {
  maxRetries: number; // Max retry attempts (default: 3)
  initialDelayMs: number; // First retry delay (default: 1000)
  maxDelayMs: number; // Max delay cap (default: 30000)
  backoffMultiplier: number; // Delay multiplier (default: 2)
  timeoutMs: number; // Request timeout (default: 10000)
  jitterFactor: number; // Randomization (default: 0.1)
}
```

### 3.4 Retryable Errors

Automatically retried:

- `ECONNREFUSED`, `ECONNRESET`, `EPIPE`
- `ETIMEDOUT`, `ENOTFOUND`
- HTTP 429 (Rate Limited)
- HTTP 5xx (Server Errors)

Not retried:

- HTTP 4xx (except 429)
- Validation errors
- Authentication errors

### 3.5 Usage

```typescript
import { fetchWithRetry, executeWithRetry } from "./retry.util";

// For HTTP requests
const result = await fetchWithRetry(url, options, {
  maxRetries: 3,
  initialDelayMs: 1000,
});

// For any async operation
const data = await executeWithRetry(() => externalService.call(), {
  maxRetries: 3,
});
```

### 3.6 Backoff Calculation

```
delay = min(initialDelay * multiplier^attempt, maxDelay) ± jitter

Example (initialDelay=1000, multiplier=2, jitter=0.1):
  Attempt 1: 1000ms ± 100ms = 900-1100ms
  Attempt 2: 2000ms ± 200ms = 1800-2200ms
  Attempt 3: 4000ms ± 400ms = 3600-4400ms
```

---

## 4. Best Practices

### 4.1 Rate Limiting

- **Communicate limits clearly**: Document in API docs
- **Provide retry-after headers**: Help clients back off appropriately
- **Consider tiered limits**: Different limits for different API key tiers
- **Monitor abuse patterns**: Identify and block bad actors

### 4.2 Queue Alerting

- **Start with wide thresholds**: Tighten based on normal patterns
- **Set up escalation**: Different channels for warning vs critical
- **Include runbooks**: Link to documentation in alerts
- **Track alert fatigue**: Too many alerts means thresholds are wrong

---

## 5. Troubleshooting

### 5.1 Rate Limiting Issues

**Problem**: Legitimate requests being limited

- Check rate limit configuration per API key
- Verify Redis connectivity
- Check clock synchronization

**Problem**: Rate limits not enforced

- Verify Redis is running
- Check API key has rate limiting enabled
- Verify middleware is applied to route

### 5.2 Queue Alert Issues

**Problem**: Not receiving alerts

- Verify webhook URLs are correct
- Check network connectivity to Slack/webhook
- Review alert cooldown settings
- Check alerting is enabled

**Problem**: Too many alerts

- Review threshold settings (may be too sensitive)
- Increase alert cooldown period
- Check for underlying infrastructure issues

---

## 6. Related Documentation

- [Data Lifecycle System](../06-data/DATA_LIFECYCLE_SYSTEM.md) - Data retention and cleanup
- [Monitoring System](../04-monitoring/MONITORING_SYSTEM.md) - Application monitoring
- [Scaling Guide](../09-deployment/SCALING_GUIDE.md) - Scaling considerations
- [Memory Management](./MEMORY_MANAGEMENT.md) - Memory optimization
