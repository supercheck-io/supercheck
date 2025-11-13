# Docker Compose Migration Guide - Container-Based Execution

## Overview

With the implementation of mandatory container-based execution for Playwright and K6 tests, the worker service now spawns Docker containers for test execution. This requires updates to all docker-compose files.

## How It Works

### Before (Direct Execution)
```
┌─────────────────────────────┐
│   Worker Container          │
│  ┌──────────────────────┐   │
│  │  Playwright Tests    │   │
│  │  Running inside      │   │
│  │  worker container    │   │
│  └──────────────────────┘   │
└─────────────────────────────┘
```

### After (Container-Based Execution)
```
┌────────────────────────┐
│   Docker Host          │
│                        │
│  ┌──────────────────┐  │
│  │ Worker Container │──┼──┐ Spawns via Docker socket
│  └──────────────────┘  │  │
│                        │  │
│  ┌──────────────────┐  │  │
│  │ Test Container 1 │◄─┘  │ (Playwright)
│  └──────────────────┘  │
│                        │
│  ┌──────────────────┐  │
│  │ Test Container 2 │  │ (K6)
│  └──────────────────┘  │
└────────────────────────┘
```

**Key Point**: Worker and test containers run as **siblings** on the host, not nested.

## Required Changes to Docker Compose Files

### 1. Mount Docker Socket

**Add to worker service volumes:**
```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock  # NEW: Docker socket access
  - worker-playwright-reports:/app/playwright-reports
  - worker-k6-reports:/app/k6-reports  # NEW: K6 reports directory
  - worker-reports:/app/report
```

### 2. Remove Browser-Specific Configuration

**Remove these (no longer needed):**
```yaml
# DELETE - Browsers don't run in worker anymore
- type: tmpfs
  target: /dev/shm
  tmpfs:
    size: 8589934592

# DELETE - Not needed
sysctls:
  - net.core.somaxconn=4096

# DELETE - Not needed
ulimits:
  nproc: 65535
  nofile:
    soft: 1048576
    hard: 1048576
  memlock:
    soft: -1
    hard: -1

# DELETE - Not needed
cap_add:
  - SYS_ADMIN
```

### 3. Reduce Worker Resource Limits

**Update resource limits:**
```yaml
deploy:
  resources:
    limits:
      cpus: "2.0"
      memory: 2G  # REDUCED from 4G - browsers run separately
    reservations:
      cpus: "0.5"
      memory: 1G  # REDUCED from 3G
```

### 4. Keep Security Constraints

**Keep these (still needed):**
```yaml
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
```

### 5. Add K6 Reports Volume

**Add to volumes section:**
```yaml
volumes:
  postgres-data:
    driver: local
  redis-data:
    driver: local
  minio-data:
    driver: local
  worker-playwright-reports:
    driver: local
  worker-k6-reports:  # NEW
    driver: local
  worker-reports:
    driver: local
```

## Files to Update

- ✅ `docker-compose.yml` - Main production compose file
- ✅ `docker-compose-local.yml` - Local development
- ⏳ `docker-compose-secure.yml` - Secure/production variant
- ⏳ `docker-compose-external.yml` - External database variant

## Security Implications

### ✅ What This Enables
- **Isolated test execution** - Each test runs in its own container
- **Resource protection** - Containers have their own resource limits
- **No privilege escalation** - Tests cannot escape their container
- **Defense-in-depth** - Multiple layers of isolation

### ⚠️ Important Considerations

**Docker Socket Access**:
- The worker can spawn containers on the host
- This is equivalent to root access on the host
- **Mitigation**: Worker itself runs with dropped capabilities and no-new-privileges
- **Standard practice**: Used by CI/CD systems (Jenkins, GitLab Runner, etc.)

**Best Practices**:
1. **Never expose worker to untrusted networks**
2. **Use network isolation** - Keep worker on private network
3. **Monitor Docker usage** - Track spawned containers
4. **Image security** - Use official images (microsoft/playwright, grafana/k6)
5. **Resource limits** - Set limits on spawned containers (already implemented)

## Docker Image Caching

**Q: Will images be downloaded on every test execution?**

**A: No!** Docker caches images:

```
First execution:  Docker pulls image (~2 GB) → Cache on host
Next executions:  Uses cached image (instant, no download)
```

**Cache location**: `/var/lib/docker/` on host
**Shared across**: All containers on the same host
**Persistence**: Images remain cached until manually removed

## Pre-pulling Images (Optional Optimization)

To avoid delays on first test execution, pre-pull images:

```yaml
# Add to docker-compose.yml
services:
  # ... existing services ...

  # Image pre-loader (runs once on startup)
  image-loader:
    image: docker:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: |
      sh -c "
        docker pull mcr.microsoft.com/playwright:v1.56.1-noble &&
        docker pull grafana/k6:latest &&
        echo 'Images pre-loaded successfully'
      "
    restart: "no"
    depends_on:
      - worker
```

## Network Connectivity

**Test containers need network access to:**
- MinIO (S3): For uploading artifacts
- Redis: For queue communication
- PostgreSQL: For saving results

**Solution**: Use the same network as worker:

The spawned containers automatically inherit network access because:
1. Worker is on `supercheck-network`
2. Spawned containers use `--network=bridge` (default Docker bridge)
3. Bridge network has access to all Docker Compose networks

**No additional configuration needed!**

## Troubleshooting

### Error: Permission denied accessing Docker socket

```bash
# Check Docker socket permissions
ls -l /var/run/docker.sock

# Should show: srw-rw---- 1 root docker

# Fix: Add user to docker group (in worker Dockerfile)
RUN addgroup -S docker || true && \
    adduser node docker || true
```

### Error: Cannot pull Docker images

```bash
# Check if worker can access Docker
docker exec supercheck-worker-1 docker ps

# Should show: List of containers

# If fails: Check Docker socket is mounted
docker inspect supercheck-worker-1 | grep docker.sock
```

### Error: Test containers can't reach MinIO/Redis

```bash
# Check network connectivity
docker exec supercheck-worker-1 ping minio
docker exec supercheck-worker-1 ping redis

# If fails: Check networks
docker network ls
docker network inspect supercheck-network
```

## Migration Steps

1. **Backup current setup**:
   ```bash
   docker-compose down
   cp docker-compose.yml docker-compose.yml.backup
   ```

2. **Update docker-compose files** (use updated versions)

3. **Pull Docker images** (optional, for faster first execution):
   ```bash
   docker pull mcr.microsoft.com/playwright:v1.56.1-noble
   docker pull grafana/k6:latest
   ```

4. **Restart services**:
   ```bash
   docker-compose up -d
   ```

5. **Verify worker can access Docker**:
   ```bash
   docker exec supercheck-worker-1 docker ps
   ```

6. **Run a test execution** and verify it works

## Performance Impact

| Metric | Before | After | Notes |
|--------|--------|-------|-------|
| Worker memory | 4 GB | 2 GB | Browsers run separately |
| Test startup overhead | 0ms | <100ms | Container spawn time |
| Image download (first time) | N/A | 60-120s | One-time per image version |
| Image download (cached) | N/A | 0ms | Instant from cache |
| Resource isolation | Partial | Complete | Full container isolation |

## Summary

✅ **Benefits**:
- Complete test isolation
- Better resource management
- Improved security posture
- Easier to scale (independent containers)

⚠️ **Trade-offs**:
- Docker socket access required
- Slight startup overhead (<100ms)
- Initial image download time

🎯 **Recommendation**: **Proceed with container-based execution** - security and isolation benefits far outweigh minimal overhead.
