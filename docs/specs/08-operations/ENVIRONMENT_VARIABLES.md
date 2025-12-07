# Environment Variables Specification

> **Version**: 1.0.0  
> **Last Updated**: 2025-12-03  
> **Status**: Production Ready

## Overview

This document provides a comprehensive reference for all environment variables used in Supercheck. Variables are organized by category with descriptions, defaults, and security considerations.

---

## Table of Contents

1. [Database Configuration](#1-database-configuration)
2. [Redis Configuration](#2-redis-configuration)
3. [Application Configuration](#3-application-configuration)
4. [Authentication Configuration](#4-authentication-configuration)
5. [Storage Configuration (S3/MinIO)](#5-storage-configuration-s3minio)
6. [Worker & Execution Configuration](#6-worker--execution-configuration)
7. [Playwright Configuration](#7-playwright-configuration)
8. [Data Lifecycle & Cleanup](#8-data-lifecycle--cleanup)
9. [AI Feature Configuration](#9-ai-feature-configuration)
10. [Email/SMTP Configuration](#10-emailsmtp-configuration)
11. [OAuth Configuration](#11-oauth-configuration)
12. [Billing Configuration (Polar)](#12-billing-configuration-polar)
13. [Security Configuration](#13-security-configuration)
14. [Notification Limits](#14-notification-limits)
15. [Deployment Mode](#15-deployment-mode)

---

## 1. Database Configuration

PostgreSQL database connection settings. For production, use managed services like **PlanetScale** with built-in connection pooling.

| Variable       | Description                       | Default      | Required   | Secret |
| -------------- | --------------------------------- | ------------ | ---------- | ------ |
| `DATABASE_URL` | Full PostgreSQL connection string | -            | ✅ Yes     | 🔒 Yes |
| `DB_HOST`      | PostgreSQL host                   | `postgres`   | For Docker | No     |
| `DB_PORT`      | PostgreSQL port                   | `5432`       | No         | No     |
| `DB_USER`      | PostgreSQL username               | `postgres`   | For Docker | No     |
| `DB_PASSWORD`  | PostgreSQL password               | `postgres`   | For Docker | 🔒 Yes |
| `DB_NAME`      | Database name                     | `supercheck` | No         | No     |

### Best Practices

```bash
# Local Development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/supercheck

# Production (PlanetScale - use port 6432 for connection pooling)
DATABASE_URL=postgresql://user:pass@your-cluster.us-east-2.psdb.cloud:6432/supercheck?sslmode=require
```

> **Note**: PlanetScale provides built-in PgBouncer on port 6432. No additional connection pooling setup required.

---

## 2. Redis Configuration

Redis connection settings for BullMQ job queues and caching. For production, use managed services like **Redis Cloud**.

| Variable         | Description                  | Default | Required       | Secret |
| ---------------- | ---------------------------- | ------- | -------------- | ------ |
| `REDIS_URL`      | Full Redis connection string | -       | ✅ Yes         | 🔒 Yes |
| `REDIS_HOST`     | Redis host                   | `redis` | For Docker     | No     |
| `REDIS_PORT`     | Redis port                   | `6379`  | No             | No     |
| `REDIS_PASSWORD` | Redis password               | -       | For production | 🔒 Yes |

### Best Practices

```bash
# Local Development (Docker)
REDIS_URL=redis://:supersecure-redis-password@localhost:6379

# Production (Redis Cloud)
REDIS_URL=redis://:password@redis-xxxxx.c123.us-east-2-1.ec2.cloud.redislabs.com:12345
```

> **Important**: Use `maxmemory-policy noeviction` for BullMQ to prevent job loss.

---

## 3. Application Configuration

Core application settings for Next.js and runtime behavior.

| Variable                  | Description                          | Default                 | Required | Secret |
| ------------------------- | ------------------------------------ | ----------------------- | -------- | ------ |
| `NODE_ENV`                | Environment mode                     | `development`           | No       | No     |
| `NEXT_PUBLIC_APP_URL`     | Public-facing app URL                | `http://localhost:3000` | ✅ Yes   | No     |
| `APP_URL`                 | Server-side app URL (for middleware) | Same as above           | No       | No     |
| `STATUS_PAGE_DOMAIN`      | Base domain for status pages         | `localhost`             | No       | No     |
| `STATUS_PAGE_BASE_DOMAIN` | Alternative base domain              | `localhost`             | No       | No     |
| `DEMO_MODE`               | Show demo badge in UI                | `false`                 | No       | No     |
| `MAX_PROJECTS_PER_ORG`    | Maximum projects per organization    | `10`                    | No       | No     |
| `DEFAULT_PROJECT_NAME`    | Default project name                 | `Default Project`       | No       | No     |

### Best Practices

```bash
# Local Development
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development

# Production
NEXT_PUBLIC_APP_URL=https://app.supercheck.io
NODE_ENV=production
```

---

## 4. Authentication Configuration

Better Auth settings for authentication and session management.

| Variable             | Description                          | Default                       | Required | Secret |
| -------------------- | ------------------------------------ | ----------------------------- | -------- | ------ |
| `BETTER_AUTH_URL`    | Auth callback URL                    | Same as `NEXT_PUBLIC_APP_URL` | ✅ Yes   | No     |
| `BETTER_AUTH_SECRET` | Session encryption secret (32 chars) | -                             | ✅ Yes   | 🔒 Yes |

### Best Practices

```bash
# Generate a secure secret
openssl rand -hex 16

# Example
BETTER_AUTH_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

> **Security**: Must be at least 32 characters. Never reuse across environments.

---

## 5. Storage Configuration (S3/MinIO)

S3-compatible storage settings for test artifacts, reports, and screenshots. For production, use **Cloudflare R2** (zero egress fees).

| Variable                | Description            | Default             | Required  | Secret |
| ----------------------- | ---------------------- | ------------------- | --------- | ------ |
| `AWS_REGION`            | AWS/S3 region          | `us-east-1`         | No        | No     |
| `AWS_ACCESS_KEY_ID`     | S3 access key          | `minioadmin`        | ✅ Yes    | 🔒 Yes |
| `AWS_SECRET_ACCESS_KEY` | S3 secret key          | `minioadmin`        | ✅ Yes    | 🔒 Yes |
| `S3_ENDPOINT`           | S3/MinIO endpoint URL  | `http://minio:9000` | ✅ Yes    | No     |
| `S3_FORCE_PATH_STYLE`   | Use path-style URLs    | `true`              | For MinIO | No     |
| `S3_OPERATION_TIMEOUT`  | Operation timeout (ms) | `10000`             | No        | No     |
| `S3_MAX_RETRIES`        | Max retry attempts     | `3`                 | No        | No     |

### Bucket Configuration

| Variable                     | Description              | Default                            |
| ---------------------------- | ------------------------ | ---------------------------------- |
| `S3_JOB_BUCKET_NAME`         | Job artifacts bucket     | `playwright-job-artifacts`         |
| `S3_TEST_BUCKET_NAME`        | Test artifacts bucket    | `playwright-test-artifacts`        |
| `S3_MONITOR_BUCKET_NAME`     | Monitor artifacts bucket | `playwright-monitor-artifacts`     |
| `S3_STATUS_BUCKET_NAME`      | Status page artifacts    | `playwright-status-artifacts`      |
| `S3_PERFORMANCE_BUCKET_NAME` | K6 performance artifacts | `supercheck-performance-artifacts` |

### Best Practices

```bash
# Local Development (MinIO)
S3_ENDPOINT=http://minio:9000
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true

# Production (Cloudflare R2)
S3_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=your-r2-access-key
AWS_SECRET_ACCESS_KEY=your-r2-secret-key
AWS_REGION=auto
S3_FORCE_PATH_STYLE=true
```

---

## 6. Worker & Execution Configuration

Worker scaling and test execution settings.

| Variable                       | Description                     | Default   | Required | Secret |
| ------------------------------ | ------------------------------- | --------- | -------- | ------ |
| `WORKER_LOCATION`              | Worker region identifier        | `global`  | No       | No     |
| `WORKER_REPLICAS`              | Number of worker replicas       | `1`       | No       | No     |
| `RUNNING_CAPACITY`             | Total concurrent test capacity  | `1`       | No       | No     |
| `QUEUED_CAPACITY`              | Maximum queue size              | `10`      | No       | No     |
| `CONTAINER_CPU_LIMIT`          | CPU limit per test container    | `1.5`     | No       | No     |
| `CONTAINER_MEMORY_LIMIT_MB`    | Memory limit per container (MB) | `2048`    | No       | No     |
| `TEST_EXECUTION_TIMEOUT_MS`    | Test timeout (ms)               | `300000`  | No       | No     |
| `JOB_EXECUTION_TIMEOUT_MS`     | Job timeout (ms)                | `3600000`  | No       | No     |
| `K6_TEST_EXECUTION_TIMEOUT_MS` | K6 test timeout (ms)            | `3600000` | No       | No     |
| `K6_JOB_EXECUTION_TIMEOUT_MS`  | K6 job timeout (ms)             | `3600000` | No       | No     |

> **Note**: `MAX_CONCURRENT_EXECUTIONS` is hardcoded to 1 in the worker code. Scale capacity by adding more worker replicas instead.

### Worker Location Values

| Value          | Description              | Use Case                 |
| -------------- | ------------------------ | ------------------------ |
| `local`        | Process all queues       | Local development        |
| `global`       | Process global queues    | Single-region deployment |
| `us-east`      | US East region only      | Multi-region deployment  |
| `eu-central`   | EU Central region only   | Multi-region deployment  |
| `asia-pacific` | Asia Pacific region only | Multi-region deployment  |

### Scaling Guidelines

```bash
# Local Development (1 worker)
WORKER_REPLICAS=1
RUNNING_CAPACITY=1

# Small Production (4 workers on Hetzner CX33 nodes)
WORKER_REPLICAS=4
RUNNING_CAPACITY=4

# Large Production (8 workers)
WORKER_REPLICAS=8
RUNNING_CAPACITY=8
```

> **Best Practice**: Scale workers horizontally (`WORKER_REPLICAS`) instead of trying to run multiple tests per worker. Each worker runs one Playwright test at a time for stability.

---

## 7. Playwright Configuration

Playwright test execution settings.

| Variable                | Description            | Default             | Required | Secret |
| ----------------------- | ---------------------- | ------------------- | -------- | ------ |
| `PLAYWRIGHT_WORKERS`    | Parallel workers in container | `1`           | No       | No     |
| `PLAYWRIGHT_RETRIES`    | Number of test retries | `1`                 | No       | No     |
| `PLAYWRIGHT_TRACE`      | Trace recording mode   | `retain-on-failure` | No       | No     |
| `PLAYWRIGHT_SCREENSHOT` | Screenshot mode        | `only-on-failure`   | No       | No     |
| `PLAYWRIGHT_VIDEO`      | Video recording mode   | `retain-on-failure` | No       | No     |

> **Worker Count Guidance**: Default of 1 worker is for 2 vCPU / 4GB servers (2GB container memory).
> Each Chromium instance uses ~600MB-1GB. For larger servers (4+ vCPU, 8GB+ RAM),
> set `PLAYWRIGHT_WORKERS=2` for better performance.

### Trace/Screenshot/Video Options

| Value               | Description                       |
| ------------------- | --------------------------------- |
| `on`                | Always capture                    |
| `off`               | Never capture                     |
| `only-on-failure`   | Capture only on test failure      |
| `retain-on-failure` | Capture all, retain only failures |

---

## 8. Data Lifecycle & Cleanup

Automated data cleanup and retention settings.

> **Note:** Retention periods are configured per plan in the database (`plan_limits` table).
> Cleanup jobs automatically use plan-based retention settings. The environment variables below
> control operational settings (schedules, batch sizes, safety limits) but not retention periods.

### Monitor Results Cleanup

| Variable                          | Description                    | Default                  |
| --------------------------------- | ------------------------------ | ------------------------ |
| `MONITOR_CLEANUP_ENABLED`         | Enable monitor cleanup         | `true`                   |
| `MONITOR_CLEANUP_CRON`            | Cleanup schedule               | `0 2 * * *` (2 AM daily) |
| `MONITOR_CLEANUP_BATCH_SIZE`      | Records per batch              | `1000`                   |
| `MONITOR_PRESERVE_STATUS_CHANGES` | Preserve status change records | `true`                   |
| `MONITOR_CLEANUP_SAFETY_LIMIT`    | Max records per cleanup        | `1000000`                |

### Monitor Aggregates Cleanup

| Variable                                  | Description               | Default                      |
| ----------------------------------------- | ------------------------- | ---------------------------- |
| `MONITOR_AGGREGATES_CLEANUP_ENABLED`      | Enable aggregates cleanup | `true`                       |
| `MONITOR_AGGREGATES_CLEANUP_CRON`         | Cleanup schedule          | `30 2 * * *` (2:30 AM daily) |
| `MONITOR_AGGREGATES_CLEANUP_BATCH_SIZE`   | Records per batch         | `1000`                       |
| `MONITOR_AGGREGATES_CLEANUP_SAFETY_LIMIT` | Max records per cleanup   | `500000`                     |

### Job Runs Cleanup

| Variable                        | Description             | Default                  |
| ------------------------------- | ----------------------- | ------------------------ |
| `JOB_RUNS_CLEANUP_ENABLED`      | Enable job cleanup      | `true`                   |
| `JOB_RUNS_CLEANUP_CRON`         | Cleanup schedule        | `0 3 * * *` (3 AM daily) |
| `JOB_RUNS_CLEANUP_BATCH_SIZE`   | Records per batch       | `100`                    |
| `JOB_RUNS_CLEANUP_SAFETY_LIMIT` | Max records per cleanup | `10000`                  |

### Playground Cleanup

| Variable                           | Description               | Default                  |
| ---------------------------------- | ------------------------- | ------------------------ |
| `PLAYGROUND_CLEANUP_ENABLED`       | Enable playground cleanup | `true`                   |
| `PLAYGROUND_CLEANUP_CRON`          | Cleanup schedule          | `0 5 * * *` (5 AM daily) |
| `PLAYGROUND_CLEANUP_MAX_AGE_HOURS` | Hours to retain artifacts | `24`                     |

### Webhook Idempotency Cleanup

| Variable                       | Description             | Default                  |
| ------------------------------ | ----------------------- | ------------------------ |
| `WEBHOOK_CLEANUP_ENABLED`      | Enable webhook cleanup  | `true`                   |
| `WEBHOOK_CLEANUP_CRON`         | Cleanup schedule        | `0 4 * * *` (4 AM daily) |
| `WEBHOOK_CLEANUP_BATCH_SIZE`   | Records per batch       | `1000`                   |
| `WEBHOOK_CLEANUP_SAFETY_LIMIT` | Max records per cleanup | `100000`                 |

---

## 9. AI Feature Configuration

OpenAI-powered AI fix and test generation settings.

| Variable         | Description          | Default       | Required        | Secret |
| ---------------- | -------------------- | ------------- | --------------- | ------ |
| `AI_PROVIDER`    | AI provider          | `openai`      | No              | No     |
| `AI_MODEL`       | AI model to use      | `gpt-4o-mini` | No              | No     |
| `OPENAI_API_KEY` | OpenAI API key       | -             | For AI features | 🔒 Yes |
| `AI_TIMEOUT_MS`  | Request timeout (ms) | `90000`       | No              | No     |
| `AI_MAX_RETRIES` | Max retry attempts   | `2`           | No              | No     |
| `AI_TEMPERATURE` | Model temperature    | `0.1`         | No              | No     |

### Best Practices

```bash
# Production (recommended model)
AI_PROVIDER=openai
AI_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-your-api-key-here
```

> **Note**: AI features include rate limiting. See `/app/src/lib/ai/ai-rate-limiter.ts` for limits.

---

## 10. Email/SMTP Configuration

SMTP settings for email notifications and alerts.

| Variable          | Description           | Default           | Required | Secret |
| ----------------- | --------------------- | ----------------- | -------- | ------ |
| `SMTP_HOST`       | SMTP server host      | `smtp.resend.com` | ✅ Yes   | No     |
| `SMTP_PORT`       | SMTP server port      | `587`             | No       | No     |
| `SMTP_USER`       | SMTP username         | `resend`          | ✅ Yes   | No     |
| `SMTP_PASSWORD`   | SMTP password/API key | -                 | ✅ Yes   | 🔒 Yes |
| `SMTP_SECURE`     | Use TLS               | `false`           | No       | No     |
| `SMTP_FROM_EMAIL` | Sender email address  | -                 | ✅ Yes   | No     |

### Provider Examples

```bash
# Resend (recommended)
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=re_your_api_key
SMTP_FROM_EMAIL=notifications@yourdomain.com

# SendGrid
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=SG.your_api_key
SMTP_FROM_EMAIL=notifications@yourdomain.com

# Gmail (not recommended for production)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_EMAIL=your@gmail.com
```

---

## 11. OAuth Configuration

Social login configuration for GitHub and Google OAuth.

| Variable               | Description                | Default | Required         | Secret |
| ---------------------- | -------------------------- | ------- | ---------------- | ------ |
| `GITHUB_CLIENT_ID`     | GitHub OAuth client ID     | -       | For GitHub login | No     |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret | -       | For GitHub login | 🔒 Yes |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID     | -       | For Google login | No     |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | -       | For Google login | 🔒 Yes |

### Setup

1. **GitHub OAuth**: Create app at https://github.com/settings/developers

   - Callback URL: `https://your-domain.com/api/auth/callback/github`

2. **Google OAuth**: Create credentials at https://console.cloud.google.com/apis/credentials
   - Callback URL: `https://your-domain.com/api/auth/callback/google`

> **Note**: OAuth buttons automatically appear when credentials are configured.

---

## 12. Billing Configuration (Polar)

Polar billing integration for SaaS deployments. Not needed for self-hosted.

| Variable                | Description                 | Default      | Required    | Secret |
| ----------------------- | --------------------------- | ------------ | ----------- | ------ |
| `POLAR_ACCESS_TOKEN`    | Polar API access token      | -            | For billing | 🔒 Yes |
| `POLAR_SERVER`          | Polar server environment    | `production` | No          | No     |
| `POLAR_WEBHOOK_SECRET`  | Webhook verification secret | -            | For billing | 🔒 Yes |
| `POLAR_PLUS_PRODUCT_ID` | Plus plan product ID        | -            | For billing | No     |
| `POLAR_PRO_PRODUCT_ID`  | Pro plan product ID         | -            | For billing | No     |

### Configuration

```bash
# Cloud deployment with billing
SELF_HOSTED=false
POLAR_ACCESS_TOKEN=pat_your_token
POLAR_WEBHOOK_SECRET=whsec_your_secret
POLAR_PLUS_PRODUCT_ID=prod_plus_id
POLAR_PRO_PRODUCT_ID=prod_pro_id

# Self-hosted (no billing)
SELF_HOSTED=true
# Polar variables not needed
```

---

## 13. Security Configuration

Security and encryption settings.

| Variable                | Description                           | Default | Required | Secret |
| ----------------------- | ------------------------------------- | ------- | -------- | ------ |
| `SECRET_ENCRYPTION_KEY` | Encryption key for secrets (32 chars) | -       | ✅ Yes   | 🔒 Yes |

### Best Practices

```bash
# Generate a secure key
openssl rand -hex 16

# Example
SECRET_ENCRYPTION_KEY=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

> **Security**: Used to encrypt sensitive data like API keys and project variables at rest.

---

## 14. Notification Limits

Limits for notification channels per entity.

| Variable                            | Description              | Default |
| ----------------------------------- | ------------------------ | ------- |
| `MAX_JOB_NOTIFICATION_CHANNELS`     | Max channels per job     | `10`    |
| `MAX_MONITOR_NOTIFICATION_CHANNELS` | Max channels per monitor | `10`    |

---

## 15. Deployment Mode

Deployment configuration for self-hosted vs cloud.

| Variable      | Description             | Default | Required | Secret |
| ------------- | ----------------------- | ------- | -------- | ------ |
| `SELF_HOSTED` | Enable self-hosted mode | `true`  | No       | No     |

### Modes

```bash
# Self-Hosted Mode (unlimited features, no billing)
SELF_HOSTED=true

# Cloud Mode (Polar billing enabled)
SELF_HOSTED=false
```

---

## Environment File Templates

### Local Development (`.env.local`)

```bash
# Database (local Docker)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/supercheck

# Redis (local Docker)
REDIS_URL=redis://:supersecure-redis-password@localhost:6379

# Application
NEXT_PUBLIC_APP_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=generate-32-char-hex-for-local-dev
NODE_ENV=development

# Storage (local MinIO)
S3_ENDPOINT=http://localhost:9000
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true

# Worker
WORKER_LOCATION=local
WORKER_REPLICAS=1
RUNNING_CAPACITY=1

# Security
SECRET_ENCRYPTION_KEY=generate-32-char-hex-for-local-dev

# Self-Hosted Mode
SELF_HOSTED=true

# Optional: AI Features
OPENAI_API_KEY=sk-your-key-here

# Optional: Email
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=re_your_key
SMTP_FROM_EMAIL=test@localhost
```

### Production (`.env.production`)

```bash
# Database (PlanetScale)
DATABASE_URL=postgresql://user:pass@cluster.psdb.cloud:6432/supercheck?sslmode=require

# Redis (Redis Cloud)
REDIS_URL=redis://:password@redis.cloud:12345

# Application
NEXT_PUBLIC_APP_URL=https://app.supercheck.io
BETTER_AUTH_URL=https://app.supercheck.io
BETTER_AUTH_SECRET=production-32-char-hex-secret
NODE_ENV=production

# Storage (Cloudflare R2)
S3_ENDPOINT=https://account-id.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=your-r2-access-key
AWS_SECRET_ACCESS_KEY=your-r2-secret-key
AWS_REGION=auto
S3_FORCE_PATH_STYLE=true

# Worker
WORKER_LOCATION=global
WORKER_REPLICAS=4
RUNNING_CAPACITY=4

# Security
SECRET_ENCRYPTION_KEY=production-32-char-hex-secret

# Self-Hosted Mode
SELF_HOSTED=true

# AI Features
OPENAI_API_KEY=sk-production-key

# Email (Resend)
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=re_production_key
SMTP_FROM_EMAIL=notifications@supercheck.io

# OAuth (optional)
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

---

## Runtime Configuration API

Supercheck exposes a runtime configuration API endpoint that allows client-side code to access server-side settings without embedding them in the build.

### GET `/api/config/app`

Returns runtime configuration settings:

```json
{
  "hosting": {
    "selfHosted": true,
    "cloudHosted": false
  },
  "authProviders": {
    "github": { "enabled": true },
    "google": { "enabled": false }
  },
  "demoMode": false,
  "limits": {
    "maxJobNotificationChannels": 10,
    "maxMonitorNotificationChannels": 10,
    "recentMonitorResultsLimit": null
  }
}
```

### React Hooks

```typescript
// Main hook for runtime configuration
import { useAppConfig } from "@/hooks/use-app-config";

function MyComponent() {
  const {
    config,
    isLoading,
    isSelfHosted,
    isCloudHosted,
    isDemoMode,
    isGithubEnabled,
    isGoogleEnabled,
    maxJobNotificationChannels,
    maxMonitorNotificationChannels,
  } = useAppConfig();

  if (isLoading) return <Loading />;
  return <div>{isDemoMode && <DemoBadge />}</div>;
}

// Convenience hooks
import { useHostingMode } from "@/hooks/use-hosting-mode";
import { useAuthProviders } from "@/hooks/use-auth-providers";
```

### Variables Exposed via API

| Variable                            | API Field                               | Description                |
| ----------------------------------- | --------------------------------------- | -------------------------- |
| `SELF_HOSTED`                       | `hosting.selfHosted`                    | Self-hosted mode enabled   |
| `GITHUB_CLIENT_ID`                  | `authProviders.github.enabled`          | GitHub OAuth configured    |
| `GOOGLE_CLIENT_ID`                  | `authProviders.google.enabled`          | Google OAuth configured    |
| `DEMO_MODE`                         | `demoMode`                              | Demo badge displayed       |
| `MAX_JOB_NOTIFICATION_CHANNELS`     | `limits.maxJobNotificationChannels`     | Job notification limit     |
| `MAX_MONITOR_NOTIFICATION_CHANNELS` | `limits.maxMonitorNotificationChannels` | Monitor notification limit |

> **Security**: No sensitive information (secrets, API keys) is exposed through this endpoint.

---

## Security Best Practices

### Secret Management

1. **Never commit secrets** to version control
2. **Use environment-specific secrets** - different keys for dev/staging/prod
3. **Rotate secrets regularly** - especially after team changes
4. **Use secret managers** in production:
   - Kubernetes Secrets + ExternalSecrets
   - AWS Secrets Manager
   - HashiCorp Vault

### Minimum Security Checklist

- [ ] `BETTER_AUTH_SECRET` is unique and 32+ characters
- [ ] `SECRET_ENCRYPTION_KEY` is unique and 32+ characters
- [ ] `REDIS_PASSWORD` is set for production
- [ ] `DATABASE_URL` uses SSL (`?sslmode=require`)
- [ ] OAuth secrets are not shared across environments
- [ ] `.env` files are in `.gitignore`

---

## Related Documentation

- [Docker Compose Guide](../09-deployment/DOCKER_COMPOSE_GUIDE.md) - Environment variables in Docker
- [Kubernetes Deployment](../09-deployment/KUBERNETES_GUIDE.md) - ConfigMaps and Secrets
- [Local Development](../09-deployment/LOCAL.md) - Development setup
