Docker Compose Infrastructure

  # Start all infrastructure services (everything except app and worker)
  docker-compose up -d postgres redis minio

  # Verify services are running
  docker-compose ps

  This will start:
  - PostgreSQL on port 5432
  - Redis on port 6379
  - MinIO on port 9000 (UI) and 9001 (API)

  Local Development Setup

  1. App Service (Next.js)

  cd app
  npm install
  npm run dev
  # Runs on http://localhost:3000

  2. Worker Service (NestJS)

  In a separate terminal:

  cd worker
  npm install
  npm run dev
  # Runs on http://localhost:3001

  Environment Configuration

  Make sure your .env.local files point to the Docker services:

  For /app/.env.local:
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/supercheck
  REDIS_URL=redis://:supersecure-redis-password-change-this@localhost:6379

  For /worker/.env.local:
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/supercheck
  REDIS_URL=redis://:supersecure-redis-password-change-this@localhost:6379

  Useful Commands

  # View logs from all infrastructure
  docker-compose logs -f postgres redis minio

  # Stop infrastructure (keeps data)
  docker-compose down

  # Stop and remove all data
  docker-compose down -v

  # Restart services
  docker-compose restart postgres redis minio

  This setup gives you hot reload for both services while all the infrastructure stays stable in Docker.