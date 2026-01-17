# Supercheck for Dokploy

One-click deployment template for Supercheck on Dokploy.

## Quick Start

### Via Dokploy Templates (After PR Merged)

1. In Dokploy, go to **Templates**
2. Search for "Supercheck"
3. Click **Deploy**

### Manual Import

1. Create a new **Compose** service
2. Go to **Advanced → Import Section**
3. Paste the Base64 configuration from the template
4. Click **Import** then **Deploy**

## What's Included

| Service | Replicas | Description |
|---------|----------|-------------|
| PostgreSQL 18 | 1 | Database with persistent storage |
| Redis 8 | 1 | Job queue and caching |
| MinIO | 1 | S3-compatible object storage |
| Supercheck App | 1 | Next.js web application |
| Supercheck Worker | **2** | Playwright + K6 test execution |

## Auto-Generated Configuration

Dokploy generates via `template.toml`:

| Helper | Variable | Description |
|--------|----------|-------------|
| `${domain}` | `APP_URL` | Auto-generated domain |
| `${username}` | `POSTGRES_USER`, `MINIO_USER` | Random usernames |
| `${password:32}` | `POSTGRES_PASSWORD`, `MINIO_PASSWORD` | 32-char passwords |
| `${password:24}` | `REDIS_PASSWORD` | 24-char password |
| `${base64:64}` | `AUTH_SECRET` | 64-byte base64 secret |
| `${base64:32}` | `ENCRYPT_KEY` | 32-byte base64 key |

## Environment Variables

### Email Notifications (for alerts and notifications)

| Variable | Required | Description |
|----------|----------|-------------|
| `SMTP_HOST` | Yes* | SMTP server (e.g., `smtp.resend.com`) |
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
| `OPENAI_API_KEY` | Yes*** | OpenAI API key |
| `ANTHROPIC_API_KEY` | Alt | Anthropic Claude API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Alt | Google Gemini API key |

***Required if you want to use AI features. Leave empty to disable AI.

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

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Main compose file |
| `template.toml` | Dokploy configuration |
| `meta.json` | Template metadata (add to root) |
| `supercheck.svg` | Logo file |

## Support

- Docs: https://supercheck.io/docs
- GitHub: https://github.com/supercheck-io/supercheck
