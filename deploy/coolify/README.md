# Supercheck on Coolify

Deploy Supercheck on [Coolify](https://coolify.io) using Docker Compose.

> **Note:** The one-click service is not yet available in Coolify's catalog (requires 1k GitHub stars). Please follow the manual deployment steps below.

## Prerequisites

- **Coolify v4.x** installed and running
- **Domain name** pointing to your Coolify server (required for SSL and authentication)
- **4 vCPU / 8 GB RAM** minimum server resources

## Quick Start

### Step 1: Create a Docker Compose Service

1. Open your Coolify dashboard
2. Navigate to your **Project** → **Environment**
3. Click **+ New** → **Docker Compose**
4. Select **Empty Compose** as the source

### Step 2: Add the Compose Configuration

1. Copy the contents of [`supercheck.yaml`](./supercheck.yaml)
2. Paste into the **Docker Compose** editor
3. Click **Save**

> **Raw file URL:**  
> `https://raw.githubusercontent.com/supercheck-io/supercheck/main/deploy/coolify/supercheck.yaml`

### Step 3: Configure Environment Variables

The template includes sensible defaults. You only need to set these in the **Environment Variables** tab:

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVICE_URL_SUPERCHECK` | *(required)* | Your app URL (e.g., `https://supercheck.yourdomain.com`) |
| `SERVICE_USER_POSTGRES` | `supercheck` | PostgreSQL username |
| `SERVICE_PASSWORD_POSTGRES` | `supercheck-db-password` | PostgreSQL password |
| `SERVICE_PASSWORD_REDIS` | `supercheck-redis-password` | Redis password |
| `SERVICE_USER_MINIO` | `minioadmin` | MinIO username |
| `SERVICE_PASSWORD_MINIO` | `minioadmin` | MinIO password |
| `SERVICE_BASE64_64_AUTH` | *(auto-generated)* | Auth secret (Coolify generates this) |
| `SERVICE_BASE64_64_ENCRYPTION` | *(auto-generated)* | Encryption key (Coolify generates this) |

> **Tip:** For production, generate secure passwords:
> ```bash
> openssl rand -base64 32  # For passwords
> openssl rand -base64 64  # For auth secret
> ```

### Step 4: Configure Domain

1. In the service list, find the **app** service
2. Click to configure its **Domains**
3. Set the domain (e.g., `supercheck.yourdomain.com`)
4. Ensure your DNS A record points to the Coolify server
5. HTTPS is automatically enabled via Caddy

### Step 5: Deploy

1. Click **Deploy** in the top right
2. Wait for all services to become healthy (2-5 minutes)
3. Access your instance at your configured domain

## Architecture

| Service | Image | Resources | Purpose |
|---------|-------|-----------|---------|
| PostgreSQL 18 | `postgres:18` | 1 CPU / 1.5 GB | Database |
| Redis 8 | `redis:8` | 0.5 CPU / 512 MB | Job queue |
| MinIO | `minio/minio:latest` | 0.5 CPU / 1 GB | Object storage |
| App | `ghcr.io/.../app:latest` | 1.5 CPU / 3 GB | Web application |
| Worker ×2 | `ghcr.io/.../worker:latest` | 1.8 CPU / 3 GB each | Test execution |

**Total**: ~6 vCPU / 12 GB RAM (minimum 4 vCPU / 8 GB for smaller deployments)

## Default Credentials (Change in Production!)

| Service | Username | Password |
|---------|----------|----------|
| PostgreSQL | `supercheck` | `supercheck-db-password` |
| Redis | - | `supercheck-redis-password` |
| MinIO | `minioadmin` | `minioadmin` |

## Optional Configuration

### Email Notifications (SMTP)

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | SMTP server (e.g., `smtp.resend.com`) |
| `SMTP_PORT` | Port (default: `587`) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASSWORD` | SMTP password |
| `SMTP_FROM_EMAIL` | Sender email address |

### OAuth Login

| Variable | Description |
|----------|-------------|
| `GITHUB_CLIENT_ID` | GitHub OAuth Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth Client Secret |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |

### AI Features

| Variable | Description |
|----------|-------------|
| `AI_PROVIDER` | Provider: `openai`, `anthropic`, `gemini` (default: `openai`) |
| `AI_MODEL` | Model ID (default: `gpt-4o-mini`) |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google Gemini API key |

### Capacity Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `RUNNING_CAPACITY` | `2` | Max concurrent test executions |
| `QUEUED_CAPACITY` | `10` | Max queued jobs |

## Troubleshooting

### Services fail to start

1. Check that `SERVICE_URL_SUPERCHECK` is set correctly
2. Verify domain DNS is properly configured
3. Review service logs in Coolify for specific errors
4. Ensure server has at least 8 GB RAM

### Authentication errors

1. Ensure `SERVICE_URL_SUPERCHECK` matches your configured domain exactly (including `https://`)
2. Verify SSL certificate is valid (Coolify handles this automatically via Caddy)
3. Check browser console for CORS or cookie errors

### Database connection issues

1. Wait for PostgreSQL to become healthy before accessing the app
2. Check that `SERVICE_USER_POSTGRES` and `SERVICE_PASSWORD_POSTGRES` are set
3. Review PostgreSQL logs for connection errors

### Worker not processing jobs

1. Verify Docker socket is mounted (`/var/run/docker.sock`)
2. Check Redis connection and password
3. Review worker logs for connection errors

## Updating

The template uses `latest` tags for app and worker images. To update:

1. Open your Docker Compose service in Coolify
2. Click **Redeploy** to pull the latest images

## Files

| File | Purpose |
|------|---------|
| `supercheck.yaml` | Main Docker Compose template |
| `supercheck.svg` | Logo for Coolify catalog |
| `README.md` | This documentation |

## Support

- **Documentation**: https://supercheck.io/docs
- **GitHub**: https://github.com/supercheck-io/supercheck
- **Issues**: https://github.com/supercheck-io/supercheck/issues
