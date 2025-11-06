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

### 2. Build and Run Services

```bash
# Build all services (first time only)
docker-compose -f docker-compose-local.yml build

# Start all services
docker-compose -f docker-compose-local.yml up

# Run in background (optional)
docker-compose -f docker-compose-local.yml up -d
```

### 3. Access the Application

Once all services are healthy, access:

- **Main App**: http://localhost:3000
- **MinIO Console**: http://localhost:9001 (credentials: minioadmin/minioadmin)
- **PostgreSQL**: localhost:5432 (credentials: postgres/postgres)
- **Redis**: localhost:6379 (password: supersecure-redis-password-change-this)

## Service Architecture

### Core Services

| Service | Port | Purpose | Container Image |
|---------|------|---------|-----------------|
| **app** | 3000 | Next.js Frontend & API | Custom (./app/Dockerfile) |
| **worker** | 3001 | NestJS Job Runner | Custom (./worker/Dockerfile) |
| **postgres** | 5432 | PostgreSQL Database | postgres:18 |
| **redis** | 6379 | Job Queue & Cache | redis:8 |
| **minio** | 9000/9001 | S3-compatible Storage | minio/minio:latest |

### Database Configuration

- **Database**: `supercheck`
- **User**: `postgres`
- **Password**: `postgres`
- **Host**: `postgres` (within Docker network)

### Redis Configuration

- **Host**: `redis`
- **Port**: `6379`
- **Password**: `supersecure-redis-password-change-this`
- **Max Memory**: 512MB
- **Eviction Policy**: noeviction

## Important Environment Variables

The following variables are configured in `docker-compose-local.yml`:

### App Configuration
- `NEXT_PUBLIC_APP_URL`: http://localhost:3000
- `NODE_ENV`: development
- `BETTER_AUTH_SECRET`: Auto-generated if not provided

### Performance Settings
- `MAX_CONCURRENT_EXECUTIONS`: 2
- `RUNNING_CAPACITY`: 2
- `QUEUED_CAPACITY`: 10
- `TEST_EXECUTION_TIMEOUT_MS`: 120000
- `JOB_EXECUTION_TIMEOUT_MS`: 900000

### Playwright Configuration
- `PLAYWRIGHT_HEADLESS`: true
- `PLAYWRIGHT_RETRIES`: 1
- `PLAYWRIGHT_TRACE`: retain-on-failure
- `PLAYWRIGHT_SCREENSHOT`: only-on-failure

### S3 / MinIO Configuration
- `S3_ENDPOINT`: http://minio:9000
- `S3_FORCE_PATH_STYLE`: true
- Buckets created:
  - `playwright-job-artifacts`
  - `playwright-test-artifacts`
  - `playwright-monitor-artifacts`
  - `supercheck-status-artifacts`

### Cleanup Jobs (Configured for Local Development)
- **Monitor Results**: Cleanup enabled at 2 AM daily (retention: 30 days)
- **Playground Artifacts**: Cleanup enabled every 12 hours (max age: 24 hours)
- **Job Runs**: Cleanup disabled by default

## Development Workflow

### View Logs

```bash
# All services
docker-compose -f docker-compose-local.yml logs -f

# Specific service
docker-compose -f docker-compose-local.yml logs -f app
docker-compose -f docker-compose-local.yml logs -f worker
docker-compose -f docker-compose-local.yml logs -f postgres
```

### Check Service Status

```bash
# View running services
docker-compose -f docker-compose-local.yml ps

# View resource usage
docker stats
```

### Access Database

```bash
# PostgreSQL CLI
docker-compose -f docker-compose-local.yml exec postgres psql -U postgres -d supercheck

# Common queries:
# \dt               - List tables
# \du               - List users
# \c supercheck     - Connect to database
```

### Access Redis

```bash
# Redis CLI
docker-compose -f docker-compose-local.yml exec redis redis-cli -a supersecure-redis-password-change-this

# Commands:
# KEYS *            - List all keys
# DBSIZE            - Number of keys
# FLUSHDB           - Clear current database
```

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

If port 3000, 5432, 6379, or 9000 is already in use:

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

Current limits in docker-compose-local.yml:
- **app**: 2GB max, 1GB reserved
- **worker**: 3GB max, 2GB reserved
- **postgres**: 1.5GB max, 1GB reserved
- **redis**: 512MB max, 256MB reserved

## Cleanup

### Stop Services

```bash
# Stop all running services
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

1. Update `DATABASE_URL` in `.env.local`
2. Update `DB_*` variables in docker-compose-local.yml

### Custom S3 Storage

To use AWS S3 instead of MinIO:

1. Update `S3_ENDPOINT` and AWS credentials in `.env.local`
2. Create required S3 buckets
3. Comment out MinIO service in docker-compose-local.yml

## Health Checks

All services have health checks configured:

| Service | Check Endpoint | Interval | Timeout |
|---------|---|---|---|
| **app** | GET /api/health | 30s | 10s |
| **worker** | GET /health:3001 | 30s | 10s |
| **postgres** | pg_isready | 10s | 5s |
| **redis** | PING | 10s | 5s |
| **minio** | mc ready local | 10s | 5s |

## Performance Tuning

### For Local Development

Current settings are optimized for development. For better performance:

1. **Increase worker replicas** (if using multiple test runs):
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
