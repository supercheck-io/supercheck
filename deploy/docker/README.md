# Docker Compose Configurations

Production-ready Docker Compose files for self-hosting SuperCheck.

## Available Configurations

### `docker-compose.yml` (Development with Pre-built Images)

Full stack using pre-built Docker images from GitHub Container Registry:
- **App**: Next.js frontend (port 3000)
- **Worker**: Job execution service
- **PostgreSQL**: Primary database (port 5432)
- **Redis**: Queue and cache (port 6379)
- **MinIO**: S3-compatible storage (ports 9000/9001)

```bash
docker compose -f docker-compose.yml up -d
```

### `docker-compose-local.yml` (Local Development)

Builds images from source with hot-reload for development:
- Builds app and worker from local `../../app` and `../../worker` directories
- Mounts source code for live changes
- Exposes all ports for debugging
- Best for active development

```bash
docker compose -f docker-compose-local.yml up -d
```

### `docker-compose-external.yml` (Managed Services)

Uses external managed services instead of local containers:
- **No PostgreSQL container** - connects to external PostgreSQL (Neon, Supabase, PlanetScale)
- **No Redis container** - connects to external Redis (Upstash, Redis Cloud)
- **No MinIO container** - connects to external S3 (AWS S3, Cloudflare R2)
- Includes Traefik for HTTPS

**Required environment variables** (no defaults):
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

### `docker-compose-secure.yml` (Production)

Production-hardened deployment with HTTPS:
- **Traefik** reverse proxy with SSL/TLS
- All services included (PostgreSQL, Redis, MinIO)
- Security hardening (capability drops, no-new-privileges)
- Resource limits configured
- Health checks enabled
- Status page wildcard subdomain support

```bash
# Configure your domain
export APP_DOMAIN=supercheck.yourdomain.com

docker compose -f docker-compose-secure.yml up -d
```

### `docker-compose-worker.yml` (Multi-Location Workers)

Deploy workers in remote geographic regions connecting to your main Supercheck instance:
- Connects to central PostgreSQL, Redis, and MinIO
- Set `WORKER_LOCATION` to target region (us-east, eu-central, asia-pacific)
- True multi-location monitoring and performance testing
- Minimal resource requirements (~2 vCPU / 4GB RAM)

```bash
# On remote VPS in US East
export DATABASE_URL=postgresql://user:pass@main-server:5432/supercheck
export REDIS_URL=redis://:password@main-server:6379
export S3_ENDPOINT=http://main-server:9000
export WORKER_LOCATION=us-east

docker compose -f docker-compose-worker.yml up -d
```

See [Multi-Location Workers Guide](https://supercheck.io/docs/deployment/multi-location) for complete setup instructions.

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

| Variable | Description | Default |
|----------|-------------|---------|
| `BETTER_AUTH_SECRET` | Auth secret (32+ chars) | `CHANGE_THIS_GENERATE_32_CHAR_HEX` |
| `SECRET_ENCRYPTION_KEY` | Encryption key (32+ chars) | `CHANGE_THIS_GENERATE_32_CHAR_HEX` |
| `REDIS_PASSWORD` | Redis password | `supersecure-redis-password-change-this` |
| `REDIS_TLS_ENABLED` | Enable TLS | `false` |

### Domain Configuration (for secure.yml)

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_DOMAIN` | Your domain | `demo.supercheck.io` |
| `ACME_EMAIL` | Let's Encrypt email | `admin@example.com` |

### Email (SMTP)

| Variable | Description | Default |
|----------|-------------|---------|
| `SMTP_HOST` | SMTP server | `smtp.resend.com` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | `resend` |
| `SMTP_PASSWORD` | SMTP password | Required |
| `SMTP_FROM_EMAIL` | From address | `notification@example.com` |

### AI Features (Optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key | Required for AI fixes |
| `AI_MODEL` | Model to use | `gpt-4o-mini` |

### Scaling

| Variable | Description | Default |
|----------|-------------|---------|
| `WORKER_REPLICAS` | Number of workers | `1` |
| `RUNNING_CAPACITY` | Max concurrent jobs | `1` |
| `QUEUED_CAPACITY` | Max queued jobs | `10` |

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
