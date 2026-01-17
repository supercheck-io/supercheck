# Supercheck on Dokploy

Deploy Supercheck on [Dokploy](https://dokploy.com) using Docker Compose.

## Prerequisites

- **Dokploy** installed and running
- **Domain name** pointing to your Dokploy server (required for SSL and authentication)
- **4 vCPU / 8 GB RAM** minimum server resources

## Quick Start (Manual Deployment)

### Step 1: Create a Compose Service

1. Open your Dokploy dashboard
2. Navigate to your **Project**
3. Click **Create Service** → **Compose**
4. Enter a name (e.g., `supercheck`)

### Step 2: Add the Compose Configuration

1. In the **General** tab, click **Edit** in the Docker Compose section
2. Paste the contents of [`docker-compose.yml`](./docker-compose.yml)
3. Click **Save**

> **Raw file URL:**  
> `https://raw.githubusercontent.com/supercheck-io/supercheck/main/deploy/dokploy/docker-compose.yml`

### Step 3: Configure Environment Variables

The template includes sensible defaults. You only need to set these in the **Environment** tab:

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_URL` | *(required)* | Your app URL (e.g., `https://supercheck.yourdomain.com`) |
| `POSTGRES_USER` | `supercheck` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `supercheck-db-password` | PostgreSQL password |
| `REDIS_PASSWORD` | `supercheck-redis-password` | Redis password |
| `MINIO_USER` | `minioadmin` | MinIO username |
| `MINIO_PASSWORD` | `minioadmin` | MinIO password |
| `AUTH_SECRET` | *(default provided)* | Auth secret (change for production) |
| `ENCRYPT_KEY` | *(default provided)* | Encryption key (change for production) |

> **For production**, generate secure secrets:
> ```bash
> openssl rand -base64 32  # For passwords and ENCRYPT_KEY
> openssl rand -base64 64  # For AUTH_SECRET
> ```

### Step 4: Configure Domain

1. Go to the **Domains** tab
2. Click **Add Domain**
3. Configure:
   - **Service Name**: `app`
   - **Port**: `3000`
   - **Host**: `supercheck.yourdomain.com`
4. Enable **HTTPS** (Dokploy handles SSL automatically)
5. Ensure your DNS A record points to the Dokploy server

### Step 5: Deploy

1. Click **Deploy**
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

## One-Click Template (Catalog)

If Supercheck is available in Dokploy's template catalog:

1. Go to **Create Service** → **Template**
2. Search for "Supercheck"
3. Click on the template card
4. Click **Deploy**
5. Configure domain and optional environment variables

## Template Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Main Docker Compose configuration |
| `template.toml` | Dokploy template configuration (for catalog) |
| `meta.json` | Template metadata (for catalog) |
| `supercheck.svg` | Logo file |
| `README.md` | This documentation |

## Troubleshooting

### Services fail to start

1. Check that `APP_URL` is set correctly
2. Verify domain DNS is properly configured
3. Review service logs in Dokploy for specific errors
4. Ensure server has at least 8 GB RAM

### Authentication errors

1. Ensure `APP_URL` matches your configured domain exactly (include `https://`)
2. Verify SSL certificate is valid (Dokploy handles this automatically)
3. Check browser console for CORS or cookie errors

### Database connection issues

1. Wait for PostgreSQL to become healthy before accessing the app
2. Check that `POSTGRES_USER` and `POSTGRES_PASSWORD` are set
3. Review PostgreSQL logs for connection errors

### Worker not processing jobs

1. Verify Docker socket is mounted (`/var/run/docker.sock`)
2. Check Redis connection and password
3. Review worker logs for connection errors

### Domain not accessible

1. Verify Traefik is running in Dokploy
2. Check domain configuration (service name and port)
3. Wait for DNS propagation if using new DNS records

## Updating

The template uses `latest` tags for app and worker images. To update:

1. Open the Compose service in Dokploy
2. Click **Redeploy** to pull the latest images

## Support

- **Documentation**: https://supercheck.io/docs
- **GitHub**: https://github.com/supercheck-io/supercheck
- **Issues**: https://github.com/supercheck-io/supercheck/issues
