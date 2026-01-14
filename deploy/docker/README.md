# Docker Compose Configurations

Production-ready Docker Compose files for self-hosting SuperCheck.

## Recommended Setup

For production deployments, we recommend using **external managed services** for PostgreSQL, Redis, and S3. This provides automatic backups, high availability, and easier maintenance.

| Configuration | Use Case | Database |
|---------------|----------|----------|
| `docker-compose-external.yml` | **Production (Recommended)** | External managed services |
| `docker-compose-secure.yml` | Production (Self-contained) | Local containers |
| `docker-compose.yml` | Development/Testing | Local containers |

---

## Available Configurations

### `docker-compose-external.yml` (Recommended for Production)

Uses external managed services for reliability and automatic backups:

- Connects to external **PostgreSQL** (Neon, Supabase, AWS RDS)
- Connects to external **Redis** (Upstash, Redis Cloud)
- Connects to external **S3** (AWS S3, Cloudflare R2)
- Includes Traefik with Let's Encrypt for HTTPS

**Required environment variables:**

```bash
DATABASE_URL=postgresql://user:pass@host:5432/supercheck
REDIS_URL=redis://:password@redis.cloud:6379
REDIS_TLS_ENABLED=true
S3_ENDPOINT=https://your-bucket.r2.cloudflarestorage.com
APP_DOMAIN=supercheck.yourdomain.com
ACME_EMAIL=admin@yourdomain.com
```

```bash
docker compose -f docker-compose-external.yml up -d
```

### `docker-compose-secure.yml` (Self-Contained Production)

All-in-one deployment with HTTPS:

- **Traefik** reverse proxy with Let's Encrypt SSL
- **PostgreSQL**, **Redis**, **MinIO** included
- Security hardening and health checks enabled

> **⚠️ Cloudflare Users:** If using Cloudflare proxy, set SSL mode to **"Full"** or **"Full (strict)"** to avoid redirect loops.

```bash
docker compose -f docker-compose-secure.yml up -d
```

### `docker-compose.yml` (Development)

For local development and testing:

- **App**: Next.js frontend (port 3000)
- **Worker**: Job execution service
- **PostgreSQL**, **Redis**, **MinIO** included

```bash
docker compose up -d
```

### `docker-compose-worker.yml` (Multi-Location Workers)

Deploy workers in remote geographic regions:

- Connects to central PostgreSQL, Redis, and MinIO
- Set `WORKER_LOCATION` to target region (us-east, eu-central, asia-pacific)

See [Multi-Location Workers Guide](https://supercheck.io/docs/deployment/multi-location) for setup instructions.


---

## Quick Setup Script

Use `init-secrets.sh` to auto-generate secure secrets for your deployment:

```bash
# Generate .env with secure secrets
./init-secrets.sh

# Edit to add OAuth credentials
nano .env

# Start services
docker compose up -d
```

## Environment Variables

All compose files use sensible defaults. Critical variables to change for production:

### Required for Production

| Variable                        | Description                | Default                                  |
| ------------------------------- | -------------------------- | ---------------------------------------- |
| `BETTER_AUTH_SECRET`            | Auth secret (32+ chars)    | `CHANGE_THIS_GENERATE_32_CHAR_HEX`       |
| `SECRET_ENCRYPTION_KEY`         | Encryption key (32+ chars) | `CHANGE_THIS_GENERATE_32_CHAR_HEX`       |
| `REDIS_PASSWORD`                | Redis password             | `supersecure-redis-password-change-this` |
| `REDIS_TLS_ENABLED`             | Enable TLS for Redis       | `false`                                  |
| `REDIS_TLS_REJECT_UNAUTHORIZED` | Reject invalid TLS certs   | `true`                                   |

### Domain Configuration (for secure.yml)

| Variable     | Description         | Default              |
| ------------ | ------------------- | -------------------- |
| `APP_DOMAIN` | Your domain         | `demo.supercheck.io` |
| `ACME_EMAIL` | Let's Encrypt email | `admin@example.com`  |

### Email (SMTP)

| Variable          | Description   | Default                    |
| ----------------- | ------------- | -------------------------- |
| `SMTP_HOST`       | SMTP server   | `smtp.resend.com`          |
| `SMTP_PORT`       | SMTP port     | `587`                      |
| `SMTP_USER`       | SMTP username | `resend`                   |
| `SMTP_PASSWORD`   | SMTP password | Required                   |
| `SMTP_FROM_EMAIL` | From address  | `notification@example.com` |

### AI Features (Optional - Multi-Provider)

Supercheck supports multiple AI providers for AI Fix, AI Create, and AI Analyze features.

| Variable       | Description                                                                 | Default      |
| -------------- | --------------------------------------------------------------------------- | ------------ |
| `AI_PROVIDER`  | Provider: openai, azure, anthropic, gemini, google-vertex, bedrock, openrouter | `openai`     |
| `AI_MODEL`     | Model ID (provider-specific)                                                | `gpt-4o-mini`|

**Provider-specific credentials** (configure ONE):

| Provider       | Required Variables                                                          |
| -------------- | --------------------------------------------------------------------------- |
| OpenAI         | `OPENAI_API_KEY`                                                            |
| Azure          | `AZURE_RESOURCE_NAME`, `AZURE_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`           |
| Anthropic      | `ANTHROPIC_API_KEY`                                                         |
| Gemini         | `GOOGLE_GENERATIVE_AI_API_KEY`                                              |
| Google Vertex  | `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`                           |
| Bedrock        | `BEDROCK_AWS_REGION`, `BEDROCK_AWS_ACCESS_KEY_ID`, `BEDROCK_AWS_SECRET_ACCESS_KEY` |
| OpenRouter     | `OPENROUTER_API_KEY`                                                        |

See the docker-compose files for detailed configuration comments.

### Scaling

| Variable           | Description         | Default |
| ------------------ | ------------------- | ------- |
| `WORKER_REPLICAS`  | Number of workers   | `1`     |
| `RUNNING_CAPACITY` | Max concurrent jobs | `1`     |
| `QUEUED_CAPACITY`  | Max queued jobs     | `10`    |

---

## Data Persistence

<details>
<summary><strong>⚠️ Important: Backup Your Data</strong></summary>

When using local PostgreSQL, data is stored in Docker named volumes. **Take regular backups:**

### Create a Backup

```bash
docker compose -f docker-compose-secure.yml exec postgres pg_dump -U postgres supercheck > backup-$(date +%Y%m%d).sql
```

### Restore from Backup

```bash
# 1. Stop app and worker
docker compose -f docker-compose-secure.yml stop app worker

# 2. Terminate active database connections
docker compose -f docker-compose-secure.yml exec -T postgres psql -U postgres -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='supercheck';"

# 3. Drop and recreate the database
docker compose -f docker-compose-secure.yml exec -T postgres psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS supercheck;"
docker compose -f docker-compose-secure.yml exec -T postgres psql -U postgres -d postgres -c "CREATE DATABASE supercheck;"

# 4. Restore the backup
cat backup-20260104.sql | docker compose -f docker-compose-secure.yml exec -T postgres psql -U postgres supercheck

# 5. Restart all services
docker compose -f docker-compose-secure.yml up -d
```

### Data Loss Risks

- Running `docker compose down -v` removes volumes
- Docker reinstallation or storage reset
- OS upgrades changing Docker storage location

**For maximum safety**, use `docker-compose-external.yml` with managed PostgreSQL.

</details>


---

## Quick Start

```bash
# Clone repository
git clone https://github.com/supercheck-io/supercheck.git
cd supercheck/deploy/docker

# Start all services (development)
docker compose -f docker-compose.yml up -d

# View logs
docker compose -f docker-compose.yml logs -f

# Access the app
open http://localhost:3000
```

## Documentation

Full documentation: **[supercheck.io/docs/deployment](https://supercheck.io/docs/deployment)**
