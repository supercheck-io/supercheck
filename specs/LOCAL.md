# Local Development Setup Guide

This guide walks you through setting up and running the Supercheck application locally using Docker Compose.

## Prerequisites

- **Docker**: Install Docker Desktop (includes Docker Compose)
- **Git**: For version control
- **System Requirements**:
  - At least 8GB RAM available
  - 20GB free disk space
  - macOS, Linux, or Windows (with WSL2)

## Quick Start

### 1. Clone and Setup Environment

```bash
# Navigate to project directory
cd supercheck

# Create .env.local file (optional - Docker Compose will use defaults)
touch .env.local

# For production secrets, add to .env.local:
# BETTER_AUTH_SECRET=<generate-32-char-hex>
# SECRET_ENCRYPTION_KEY=<generate-32-char-hex>
```

### 2. Start Infrastructure Services

```bash
# Start infrastructure only (recommended for local development)
docker-compose -f docker-compose-local.yml up -d

# This starts: postgres, redis, minio, clickhouse-observability, schema-migrator, otel-collector
# App and worker services are commented out for local development
```

### 3. Run App and Worker Locally

```bash
# Terminal 1 - App Service (Next.js)
cd app
npm install
npm run dev
# Runs on http://localhost:3000

# Terminal 2 - Worker Service (NestJS)
cd worker
npm install
npm run dev
# Runs on http://localhost:3001
```

## Service Architecture

### Infrastructure Components (Running in Docker)

| Service | Port | Purpose | Container Image |
|---------|------|---------|-----------------|
| **postgres** | 5432 | PostgreSQL Database | postgres:18 |
| **redis** | 6379 | Job Queue & Cache | redis:8 |
| **minio** | 9000/9002 | S3-compatible Storage | minio/minio:latest |
| **clickhouse-observability** | 8124/9001 | Time-series Database | clickhouse/clickhouse-server:25.5.6 |
| **otel-collector** | 4317/4318 | OpenTelemetry Collector | signoz/signoz-otel-collector:v0.129.8 |

### Local Development Services

| Service | Port | Purpose |
|---------|------|---------|
| **app** | 3000 | Next.js Frontend & API (run locally) |
| **worker** | 3001 | NestJS Job Runner (run locally) |

### Database Configuration

- **Database**: `supercheck`
- **User**: `postgres`
- **Password**: `postgres`
- **Host**: `localhost` (for local app/worker)

### Redis Configuration

- **Host**: `localhost`
- **Port**: `6379`
- **Password**: `supersecure-redis-password-change-this`

### MinIO Configuration

- **API Endpoint**: http://localhost:9000
- **Console**: http://localhost:9002
- **Access Key**: `minioadmin`
- **Secret Key**: `minioadmin`

### S3 Buckets (Auto-created by Worker)

The worker automatically creates these buckets on startup:
- `playwright-job-artifacts`
- `playwright-test-artifacts`
- `playwright-monitor-artifacts`
- `k6-status-artifacts`
- `k6-performance-artifacts`

## Environment Configuration

### App Environment (/app/.env.local)

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/supercheck
REDIS_URL=redis://:supersecure-redis-password-change-this@localhost:6379
CLICKHOUSE_URL=http://localhost:8124
S3_ENDPOINT=http://localhost:9000
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
```

### Worker Environment (/worker/.env.local)

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/supercheck
REDIS_URL=redis://:supersecure-redis-password-change-this@localhost:6379
S3_ENDPOINT=http://localhost:9000
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
```

## Development Workflow

### Infrastructure Commands

```bash
# Start infrastructure services
docker-compose -f docker-compose-local.yml up -d

# View infrastructure logs
docker-compose -f docker-compose-local.yml logs -f postgres redis minio clickhouse-observability otel-collector

# Stop infrastructure (keeps data)
docker-compose -f docker-compose-local.yml down

# Stop and remove all data
docker-compose -f docker-compose-local.yml down -v

# Restart services
docker-compose -f docker-compose-local.yml restart postgres redis minio clickhouse-observability schema-migrator otel-collector
```

### Local Development Commands

```bash
# Terminal 1 - App
cd app
npm run dev

# Terminal 2 - Worker
cd worker
npm run dev

# Run database migrations (if needed)
cd app && npm run db:migrate
```

### Database Access

```bash
# Connect to PostgreSQL
docker-compose -f docker-compose-local.yml exec postgres psql -U postgres -d supercheck

# Common queries:
# \dt               - List tables
# \du               - List users
# \c supercheck     - Connect to database
```

### Access MinIO Console

Open http://localhost:9002 in browser
- Username: `minioadmin`
- Password: `minioadmin`

## Troubleshooting

### Services Not Starting

1. **Check Docker is running**:
   ```bash
   docker ps
   ```

2. **View error logs**:
   ```bash
   docker-compose -f docker-compose-local.yml logs
   ```

3. **Verify disk space**:
   ```bash
   docker system df
   ```

### Port Already in Use

If port 3000, 5432, 6379, 9000, or 9002 is already in use:

```bash
# Find what's using the port (macOS/Linux)
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or change port in docker-compose-local.yml
```

### Database Connection Issues

```bash
# Check PostgreSQL is healthy
docker-compose -f docker-compose-local.yml exec postgres pg_isready -U postgres

# View PostgreSQL logs
docker-compose -f docker-compose-local.yml logs postgres
```

### S3 Bucket Issues

The worker automatically creates buckets on startup. If you see "NoSuchBucket" errors:

1. Restart the worker service
2. Check worker logs for bucket creation messages
3. Verify MinIO is accessible at http://localhost:9000

### Worker/App Not Communicating

```bash
# Test connectivity between containers
docker-compose -f docker-compose-local.yml exec app ping worker
docker-compose -f docker-compose-local.yml exec worker ping app
```

### Out of Memory / Slow Performance

Increase Docker resource limits:

1. Open Docker Desktop Settings
2. Go to Resources
3. Increase CPU and Memory allocation
4. Restart Docker

## Cleanup

### Stop Services

```bash
# Stop infrastructure services
docker-compose -f docker-compose-local.yml down

# Stop and remove all data (volumes)
docker-compose -f docker-compose-local.yml down -v

# Stop and remove images
docker-compose -f docker-compose-local.yml down --rmi all
```

### Full System Cleanup

```bash
# Remove all unused Docker resources
docker system prune -a

# Remove all unused volumes
docker volume prune
```

## Advanced Configuration

### Full Docker Development

If you prefer to run everything in Docker (instead of hybrid):

```bash
# Uncomment app and worker services in docker-compose-local.yml
# Then run:
docker-compose -f docker-compose-local.yml up -d
```

### Enable Additional Browsers

To test with Firefox and WebKit (disabled by default):

Edit environment variables in `docker-compose-local.yml`:
```yaml
ENABLE_FIREFOX: true
ENABLE_WEBKIT: true
ENABLE_MOBILE: false  # Optional: enable mobile testing
```

### Custom Database

To use external PostgreSQL:

1. Update `DATABASE_URL` in local `.env.local` files
2. Update `DB_*` variables in docker-compose-local.yml

### Custom S3 Storage

To use AWS S3 instead of MinIO:

1. Update `S3_ENDPOINT` and AWS credentials in local `.env.local` files
2. Create required S3 buckets
3. Comment out MinIO service in docker-compose-local.yml

## Performance Tuning

### For Local Development

Current settings are optimized for development. For better performance:

1. **Increase worker replicas** (if using Docker):
   ```yaml
   deploy:
     replicas: 2  # Increase from 1
   ```

2. **Adjust concurrent executions**:
   ```yaml
   MAX_CONCURRENT_EXECUTIONS: 4  # Increase from 2
   ```

3. **Increase memory for worker**:
   ```yaml
   memory: 4G  # Increase from 3G
   ```

### System Tuning

```bash
# Increase system file descriptors (Linux)
ulimit -n 65535

# Check shared memory (required for Playwright)
df -h /dev/shm
```

## Production Checklist

Before deploying to production:

- [ ] Change all default passwords (Redis, MinIO, Database)
- [ ] Generate secure `BETTER_AUTH_SECRET` (32-char hex)
- [ ] Generate secure `SECRET_ENCRYPTION_KEY` (32-char hex)
- [ ] Update `STATUS_PAGE_DOMAIN` from supercheck.io
- [ ] Configure SMTP credentials (Resend or other provider)
- [ ] Update OpenAI API key for AI features
- [ ] Use external PostgreSQL/Redis instead of containers
- [ ] Enable HTTPS/TLS
- [ ] Configure proper logging and monitoring
- [ ] Set `NODE_ENV` to production
- [ ] Increase resource limits appropriately

## Additional Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Next.js Documentation](https://nextjs.org/docs)
- [NestJS Documentation](https://docs.nestjs.com/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Playwright Documentation](https://playwright.dev/)

This setup gives you flexibility between full Docker deployment and hybrid development with hot reload capabilities.