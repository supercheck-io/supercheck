# Supercheck for Coolify

One-click deployment template for Supercheck on Coolify.

## Quick Start

1. In Coolify, go to **Project → New Service → One-Click Services**
2. Search for "Supercheck"
3. Configure your domain
4. Click **Deploy**

## What's Included

| Service | Replicas | Description |
|---------|----------|-------------|
| PostgreSQL 18 | 1 | Database with persistent storage |
| Redis 8 | 1 | Job queue and caching |
| MinIO | 1 | S3-compatible object storage |
| Supercheck App | 1 | Next.js web application |
| Supercheck Worker | **2** | Playwright + K6 test execution |

## Auto-Generated Configuration

Coolify automatically generates secure credentials:

| Variable | Description |
|----------|-------------|
| `SERVICE_USER_POSTGRES` | PostgreSQL username |
| `SERVICE_PASSWORD_POSTGRES` | PostgreSQL password |
| `SERVICE_PASSWORD_REDIS` | Redis password |
| `SERVICE_USER_MINIO` | MinIO access key |
| `SERVICE_PASSWORD_MINIO` | MinIO secret key |
| `SERVICE_BASE64_64_AUTH` | Auth secret (64 bytes) |
| `SERVICE_BASE64_64_ENCRYPTION` | Encryption key (64 bytes) |

## Environment Variables

### Email Notifications (for alerts and notifications)

| Variable | Required | Description |
|----------|----------|-------------|
| `SMTP_HOST` | Yes* | SMTP server (e.g., `smtp.resend.com`) |
| `SMTP_PORT` | No | Port (default: 587) |
| `SMTP_USER` | Yes* | SMTP username |
| `SMTP_PASSWORD` | Yes* | SMTP password |
| `SMTP_FROM_EMAIL` | Yes* | From email address |

*Required for email notifications. Leave empty to disable.

### OAuth Login (for GitHub/Google social login)

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_CLIENT_ID` | Yes** | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | Yes** | GitHub OAuth App Client Secret |
| `GOOGLE_CLIENT_ID` | Yes** | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes** | Google OAuth Client Secret |

**Required if you want GitHub/Google login. Email/password login works without OAuth.

### AI Features (for AI-powered test creation/fixing)

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_PROVIDER` | No | Provider (default: `openai`) |
| `AI_MODEL` | No | Model (default: `gpt-4o-mini`) |
| `OPENAI_API_KEY` | Yes*** | OpenAI API key |
| `ANTHROPIC_API_KEY` | Alt | Anthropic Claude API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Alt | Google Gemini API key |

***Required if you want to use AI features. Leave empty to disable AI.

### CAPTCHA (for bot protection)

| Variable | Required | Description |
|----------|----------|-------------|
| `TURNSTILE_SITE_KEY` | Yes**** | Cloudflare Turnstile site key |
| `TURNSTILE_SECRET_KEY` | Yes**** | Cloudflare Turnstile secret key |

****Required for CAPTCHA protection. Leave empty to disable.

### Capacity Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `RUNNING_CAPACITY` | 2 | Max concurrent test executions |
| `QUEUED_CAPACITY` | 10 | Max queued jobs |

## Resource Requirements

> **Optimized for 4 vCPU / 8 GB RAM servers**

| Service | CPU | Memory |
|---------|-----|--------|
| PostgreSQL | 0.5 | 1 GB |
| Redis | 0.25 | 512 MB |
| MinIO | 0.25 | 512 MB |
| App | 1.0 | 2 GB |
| Worker × 2 | 2.0 | 4 GB |
| **Total** | **4.0** | **8 GB** |

## Support

- Docs: https://supercheck.io/docs
- GitHub: https://github.com/supercheck-io/supercheck
