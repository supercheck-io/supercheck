# Docker Compose Deployment Guide

> **Version**: 2.0.0  
> **Last Updated**: 2025-12-03  
> **Status**: Production Ready

Complete guide for deploying Supercheck using Docker Compose. This is the recommended approach for **self-hosted deployments** and **local development**.

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Compose File Variants](#compose-file-variants)
3. [Environment Setup](#environment-setup)
4. [Deployment Instructions](#deployment-instructions)
5. [Scaling & Management](#scaling--management)
6. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Local Development (30 seconds)

```bash
cd deploy
docker-compose -f docker/docker-compose-local.yml up -d

# View logs
docker-compose -f docker/docker-compose-local.yml logs -f
```

**Access:** http://localhost:3000

### Production with External Services (2 minutes)

```bash
cd deploy

# Set environment variables
export DATABASE_URL="postgresql://user:pass@postgres.example.com:5432/supercheck"
export REDIS_URL="redis://:password@redis.example.com:6379"
export AWS_ACCESS_KEY_ID="your-key"
export AWS_SECRET_ACCESS_KEY="your-secret"
export S3_ENDPOINT="https://r2.example.com"
export BETTER_AUTH_SECRET="your-32-char-secret"

# Deploy
docker-compose -f docker/docker-compose-external.yml up -d
```

---

## Compose File Variants

### 1. **docker-compose-local.yml** (Development)

**Use when:** Developing locally with all services in containers

**Features:**

- ✅ All services included (PostgreSQL, Redis, MinIO)
- ✅ Hot reload support for worker code
- ✅ Development-friendly defaults
- ✅ 1 worker replica (adjust with `WORKER_REPLICAS`)
- ✅ Docker socket mounting for test execution

**Services:**

- PostgreSQL (port 5432)
- Redis (port 6379)
- MinIO (port 9000, console 9001)
- Next.js App (port 3000)
- Worker (processes all queues)

**Command:**

```bash
docker-compose -f docker/docker-compose-local.yml up -d
```

**Scale workers:**

```bash
WORKER_REPLICAS=2 docker-compose -f docker/docker-compose-local.yml up -d
```

---

### 2. **docker-compose.yml** (Production - Docker Engine)

**Use when:** Deploying to production with Docker Engine (VPS, bare metal)

**Features:**

- ✅ External database/Redis support (via env vars)
- ✅ Production security hardening
- ✅ Read-only Docker socket mount
- ✅ Proper restart policies
- ✅ 4 worker replicas (adjustable)
- ✅ S3/MinIO support

**Services:**

- Next.js App
- Workers (scaled via `WORKER_REPLICAS`)
- External: PostgreSQL, Redis, S3

**Command:**

```bash
docker-compose -f docker/docker-compose.yml up -d
```

**Scale to 8 workers:**

```bash
WORKER_REPLICAS=8 docker-compose -f docker/docker-compose.yml up -d
```

**Environment variables required:**

```bash
DATABASE_URL              # PostgreSQL connection string
REDIS_URL               # Redis connection string
BETTER_AUTH_SECRET      # 32-char random secret
AWS_ACCESS_KEY_ID       # S3/MinIO access key
AWS_SECRET_ACCESS_KEY   # S3/MinIO secret key
S3_ENDPOINT            # S3/MinIO endpoint URL
WORKER_LOCATION        # us-east, eu-central, asia-pacific, or global
```

---

### 3. **docker-compose-secure.yml** (Production + HTTPS + Traefik)

**Use when:** Production deployment with HTTPS/TLS and Traefik reverse proxy

**Features:**

- ✅ Traefik reverse proxy with automatic HTTPS
- ✅ Let's Encrypt certificate management
- ✅ Status page routing (HostRegexp)
- ✅ All services in containers
- ✅ Self-signed cert support
- ✅ 3 worker replicas for monitoring

**Services:**

- Traefik (HTTPS reverse proxy)
- Next.js App
- Workers (3 replicas)
- PostgreSQL
- Redis
- MinIO

**Command:**

```bash
docker-compose -f docker/docker-compose-secure.yml up -d
```

**Environment variables:**

```bash
BETTER_AUTH_SECRET      # 32-char random secret
# All others have sensible defaults
```

**Access:**

- App: https://demo.supercheck.io
- MinIO Console: https://demo.supercheck.io:9001 (via Traefik, configure separately)
- Status Pages: https://{subdomain}.supercheck.io

**Configure Traefik HTTPS:**

```bash
# For Let's Encrypt:
export ACME_EMAIL="your-email@example.com"
docker-compose -f docker/docker-compose-secure.yml up -d

# For Cloudflare/external SSL:
# Edit the traefik service labels to use external SSL termination
```

---

### 4. **docker-compose-external.yml** (Production + HTTPS + External Services)

**Use when:** Production with external managed services and Traefik HTTPS

**Features:**

- ✅ External PostgreSQL (AWS RDS, etc.)
- ✅ External Redis (ElastiCache, etc.)
- ✅ External S3 (AWS S3, Cloudflare R2, etc.)
- ✅ Traefik HTTPS reverse proxy
- ✅ Minimal container overhead
- ✅ 4 worker replicas

**Services:**

- Traefik (HTTPS)
- Next.js App
- Workers (4 replicas)
- External: PostgreSQL, Redis, S3

**Command:**

```bash
docker-compose -f docker/docker-compose-external.yml up -d
```

**Required environment variables:**

```bash
# Database
DATABASE_URL="postgresql://user:pass@rds-instance.amazonaws.com:5432/supercheck"
DB_HOST="rds-instance.amazonaws.com"
DB_PORT="5432"
DB_USER="supercheck"
DB_PASSWORD="your-password"
DB_NAME="supercheck"

# Redis
REDIS_HOST="elasticache-endpoint.amazonaws.com"
REDIS_PORT="6379"
REDIS_PASSWORD="your-redis-password"
REDIS_URL="redis://:password@elasticache-endpoint.amazonaws.com:6379"

# S3/Storage
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"
S3_ENDPOINT="https://your-bucket.s3.amazonaws.com"
# or for Cloudflare R2:
# S3_ENDPOINT="https://your-account.r2.cloudflarestorage.com"

# App
NEXT_PUBLIC_APP_URL="https://supercheck.example.com"
APP_URL="https://supercheck.example.com"
BETTER_AUTH_URL="https://supercheck.example.com"
BETTER_AUTH_SECRET="your-32-char-secret"

# Traefik/HTTPS
APP_DOMAIN="supercheck.example.com"
ACME_EMAIL="admin@example.com"

# Worker
WORKER_LOCATION="global"  # or us-east, eu-central, asia-pacific
```

---

## Environment Setup

### Local Development

```bash
cd deploy

# Start with defaults (single worker)
docker-compose -f docker/docker-compose-local.yml up -d

# Or with multiple workers for testing
WORKER_REPLICAS=3 docker-compose -f docker/docker-compose-local.yml up -d
```

### Production with Docker Engine

Create `.env` file:

```bash
# Database Configuration
DATABASE_URL=postgresql://supercheck:password@postgres.example.com:5432/supercheck
DB_HOST=postgres.example.com
DB_PORT=5432
DB_USER=supercheck
DB_PASSWORD=your-secure-password
DB_NAME=supercheck

# Redis Configuration
REDIS_HOST=redis.example.com
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_URL=redis://:your-redis-password@redis.example.com:6379

# App Configuration
NEXT_PUBLIC_APP_URL=https://supercheck.example.com
APP_URL=https://supercheck.example.com
BETTER_AUTH_URL=https://supercheck.example.com
BETTER_AUTH_SECRET=generate-32-char-hex-string-here

# S3/Storage
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-s3-access-key
AWS_SECRET_ACCESS_KEY=your-s3-secret-key
S3_ENDPOINT=https://s3.amazonaws.com
# or for Cloudflare R2:
# S3_ENDPOINT=https://your-account.r2.cloudflarestorage.com

# Worker Configuration
WORKER_LOCATION=global
WORKER_REPLICAS=4

# AI Features
OPENAI_API_KEY=sk-your-openai-key

# Email/Notifications
SMTP_HOST=smtp.resend.com
SMTP_USER=resend
SMTP_PASSWORD=your-resend-key
SMTP_FROM_EMAIL=notifications@example.com

# Optional: OAuth
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

Deploy:

```bash
docker-compose -f docker/docker-compose.yml up -d
```

### Production with HTTPS (Traefik)

Create `.env` file with all the above variables plus:

```bash
# Traefik/HTTPS
APP_DOMAIN=supercheck.example.com
ACME_EMAIL=admin@example.com

# Optional: Cloudflare
CLOUDFLARE_API_TOKEN=your-token  # for DNS challenge
```

Deploy:

```bash
docker-compose -f docker/docker-compose-external.yml up -d
```

---

## Deployment Instructions

### Step-by-Step: Local Development

1. **Start services:**

   ```bash
   cd deploy
   docker-compose -f docker/docker-compose-local.yml up -d
   ```

2. **Wait for readiness:**

   ```bash
   docker-compose -f docker/docker-compose-local.yml logs -f app
   # Look for "Ready on http://localhost:3000"
   ```

3. **Access the app:**

   ```
   http://localhost:3000
   ```

4. **View logs:**

   ```bash
   docker-compose -f docker/docker-compose-local.yml logs -f
   docker-compose -f docker/docker-compose-local.yml logs -f worker
   ```

5. **Scale workers for testing:**
   ```bash
   WORKER_REPLICAS=2 docker-compose -f docker/docker-compose-local.yml up -d
   ```

### Step-by-Step: Production Deployment

1. **Prepare server:**

   ```bash
   # SSH into your server
   ssh user@server.com

   # Install Docker & Docker Compose
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh

   # Add user to docker group
   sudo usermod -aG docker $USER
   newgrp docker
   ```

2. **Clone and setup:**

   ```bash
   git clone https://github.com/supercheck-io/supercheck.git
   cd supercheck

   # Create .env file with production variables
   nano deploy/.env
   ```

3. **Deploy with external services:**

   ```bash
   cd deploy
   docker-compose -f docker/docker-compose-external.yml up -d
   ```

4. **Monitor deployment:**

   ```bash
   # Check service status
   docker-compose -f docker/docker-compose-external.yml ps

   # View app logs
   docker-compose -f docker/docker-compose-external.yml logs -f app

   # Check worker logs
   docker-compose -f docker/docker-compose-external.yml logs -f worker
   ```

5. **Verify HTTPS:**
   ```bash
   curl -I https://supercheck.example.com
   # Should return 200 OK
   ```

---

## Scaling & Management

### Horizontal Scaling

#### Scale Workers

```bash
# Scale to 8 workers
WORKER_REPLICAS=8 docker-compose -f docker/docker-compose.yml up -d

# Verify
docker-compose -f docker/docker-compose.yml ps | grep worker
```

#### Scale App Replicas (Traefik only)

Edit `docker-compose-external.yml` or `docker-compose-secure.yml`:

```yaml
app:
  deploy:
    replicas: 2 # Default is 1
```

Then:

```bash
docker-compose -f docker/docker-compose-external.yml up -d
```

### Monitoring

#### View Container Status

```bash
docker-compose -f docker/docker-compose.yml ps
```

#### Check Resource Usage

```bash
docker stats

# Or for specific containers
docker stats supercheck-app supercheck-worker
```

#### View Logs

```bash
# All services
docker-compose -f docker/docker-compose.yml logs -f

# Specific service
docker-compose -f docker/docker-compose.yml logs -f worker
docker-compose -f docker/docker-compose.yml logs -f app

# Last 100 lines
docker-compose -f docker/docker-compose.yml logs --tail=100 app
```

#### Database Health

```bash
# Check PostgreSQL
docker exec supercheck-postgres pg_isready -U supercheck

# Check Redis
docker exec supercheck-redis redis-cli -a password ping
# Should return PONG
```

### Maintenance

#### Restart Services

```bash
# Restart all services
docker-compose -f docker/docker-compose.yml restart

# Restart specific service
docker-compose -f docker/docker-compose.yml restart worker

# Graceful restart (drain workers)
docker-compose -f docker/docker-compose.yml restart worker
```

#### Update Container Images

```bash
# Pull latest images
docker-compose -f docker/docker-compose.yml pull

# Recreate containers with new images
docker-compose -f docker/docker-compose.yml up -d
```

#### Backup Data

```bash
# Backup PostgreSQL
docker exec supercheck-postgres pg_dump -U supercheck supercheck > backup.sql

# Backup Redis data
docker cp supercheck-redis:/data/dump.rdb ./redis-backup.rdb

# Backup MinIO data (if using local)
docker cp supercheck-minio:/data ./minio-backup
```

#### Cleanup

```bash
# Stop all containers
docker-compose -f docker/docker-compose.yml down

# Remove volumes (⚠️ deletes data)
docker-compose -f docker/docker-compose.yml down -v

# Remove dangling images
docker image prune -f

# Remove unused networks
docker network prune -f
```

---

## Troubleshooting

### Containers Won't Start

```bash
# Check logs
docker-compose -f docker/docker-compose.yml logs app

# Common issues:
# 1. Port already in use
netstat -tlnp | grep :3000
sudo lsof -i :3000

# 2. Environment variables not set
docker-compose -f docker/docker-compose.yml config | grep WORKER_LOCATION

# 3. Docker socket not available
ls -la /var/run/docker.sock
```

### Worker Can't Execute Tests

```bash
# Check Docker socket access
docker exec supercheck-worker docker ps

# If it fails:
# 1. Verify Docker socket is mounted
docker inspect supercheck-worker | grep docker.sock

# 2. Check socket permissions on host
ls -la /var/run/docker.sock

# 3. Restart worker
docker-compose -f docker/docker-compose.yml restart worker
```

### Database Connection Errors

```bash
# Test PostgreSQL connection
docker-compose -f docker/docker-compose.yml exec app psql $DATABASE_URL

# Or from host
psql $DATABASE_URL

# Check if migrations ran
docker-compose -f docker/docker-compose.yml logs app | grep migration
```

### Redis Connection Issues

```bash
# Test Redis connection
docker exec supercheck-redis redis-cli -a password ping

# Check Redis info
docker exec supercheck-redis redis-cli -a password info server

# Verify REDIS_URL format
echo $REDIS_URL
```

### Out of Memory (OOM)

```bash
# Check memory usage
docker stats

# Reduce worker replicas
WORKER_REPLICAS=2 docker-compose -f docker/docker-compose.yml up -d

# Or increase container limits in compose file:
# memory: 4G  # from 3G
```

### High CPU Usage

```bash
# Check which container is using CPU
docker stats

# Check worker load
docker-compose -f docker/docker-compose.yml logs -f worker | head -50

# Scale horizontally
WORKER_REPLICAS=4 docker-compose -f docker/docker-compose.yml up -d
```

---

## Comparison: Which Compose File to Use?

| Scenario           | File                          | Pros                                     | Cons                          |
| ------------------ | ----------------------------- | ---------------------------------------- | ----------------------------- |
| **Local Dev**      | `docker-compose-local.yml`    | Easy setup, all-in-one, hot reload       | Uses local resources          |
| **Simple Prod**    | `docker-compose.yml`          | Production defaults, security hardened   | Still needs external services |
| **Prod + HTTPS**   | `docker-compose-secure.yml`   | Full setup, Traefik included             | Complex, needs ACME setup     |
| **Prod + Managed** | `docker-compose-external.yml` | Cloud-native, scalable, minimal overhead | Requires AWS/managed services |

---

## Environment Variables Reference

### Common Variables (All Files)

```bash
NODE_ENV=production
WORKER_LOCATION=global                    # or us-east, eu-central, asia-pacific
MAX_CONCURRENT_EXECUTIONS=1               # Keep at 1, scale replicas instead
RUNNING_CAPACITY=4
QUEUED_CAPACITY=50
CONTAINER_CPU_LIMIT=1.5
CONTAINER_MEMORY_LIMIT_MB=2048
```

### Database & Cache

```bash
DATABASE_URL=postgresql://user:pass@host:5432/supercheck
REDIS_URL=redis://:password@host:6379
```

### Storage (S3/MinIO)

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=key
AWS_SECRET_ACCESS_KEY=secret
S3_ENDPOINT=https://s3.amazonaws.com
S3_FORCE_PATH_STYLE=true
```

### Security

```bash
BETTER_AUTH_SECRET=generate-32-char-hex
SECRET_ENCRYPTION_KEY=generate-32-char-hex
```

### Optional: Features

```bash
OPENAI_API_KEY=sk-...                     # For AI features
GITHUB_CLIENT_ID=...                      # For OAuth
GOOGLE_CLIENT_ID=...                      # For OAuth
```

---

## Next Steps

1. **Choose your setup:**

   - Local: `docker-compose-local.yml`
   - Production: `docker-compose-external.yml` (recommended)

2. **Prepare environment variables** (.env file)

3. **Deploy:** `docker-compose -f docker/docker-compose-xxx.yml up -d`

4. **Monitor:** `docker-compose -f docker/docker-compose-xxx.yml logs -f`

5. **Scale:** `WORKER_REPLICAS=X docker-compose -f ... up -d`

---

## Support

For issues:

- Check logs: `docker-compose logs -f`
- Verify environment variables: `docker-compose config | grep VAR_NAME`
- Check Docker socket: `ls -la /var/run/docker.sock`
- View Traefik dashboard: https://supercheck.example.com/dashboard/
