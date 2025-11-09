# Observability Configuration Guide

This document explains how to configure the Supercheck observability system to work with SigNoz and ClickHouse.

## Overview

Supercheck uses SigNoz for observability data storage and visualization. There are two ways to query observability data:

1. **SigNoz Query API** (recommended for production)
2. **Direct ClickHouse Queries** (recommended for local development)

## Authentication Challenges with SigNoz v0.100.1

SigNoz v0.100.1 requires authentication for all API calls. Unfortunately:

- There is **no built-in way to disable authentication** in v0.100.1
- The `SIGNOZ_AUTH_ENABLED=false` option was added in later versions (PR #8999)
- Self-registration is disabled by default
- API key management requires UI access with authenticated session

## Configuration Options

### Option 1: Direct ClickHouse Access (Current Setup)

This is the **recommended approach for local development** and internal deployments.

**When to use:**
- Local development environment
- Internal deployments where security is managed at network level
- SigNoz v0.100.1 or earlier
- No API credentials available

**Configuration:**

```bash
# .env file
USE_CLICKHOUSE_DIRECT=true
CLICKHOUSE_URL=http://localhost:8124
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=default

# Optional: These are still used as fallback
SIGNOZ_URL=http://localhost:8080
SIGNOZ_DISABLE_AUTH=true
```

**Docker Compose Setup:**

The SigNoz ClickHouse container must expose HTTP port:

```yaml
# observability/deploy/docker/docker-compose.yaml
clickhouse:
  ports:
    - "9001:9000"  # Native protocol
    - "8124:8123"  # HTTP interface
```

**Advantages:**
✅ No authentication required
✅ Faster queries (no API layer overhead)
✅ Direct access to raw data
✅ Works with any SigNoz version

**Disadvantages:**
❌ Bypasses SigNoz's query optimization
❌ Requires ClickHouse port exposure
❌ Schema changes in SigNoz may break queries

### Option 2: SigNoz Query API with Authentication

This is the **recommended approach for production** deployments.

**When to use:**
- Production deployments
- SigNoz Cloud
- Multi-tenant environments
- SigNoz versions with API key support

**Configuration:**

```bash
# .env file
USE_CLICKHOUSE_DIRECT=false
SIGNOZ_URL=http://localhost:8080
SIGNOZ_API_KEY=your-api-key-here
# OR
SIGNOZ_BEARER_TOKEN=your-bearer-token-here
```

**How to get API credentials:**

1. Access SigNoz UI at http://localhost:8080
2. Log in with admin credentials
3. Go to Settings → API Keys
4. Create a new API key with appropriate permissions
5. Copy the key to your `.env` file

**Advantages:**
✅ Follows SigNoz best practices
✅ Query optimization and caching
✅ Role-based access control
✅ Better for multi-tenant setups

**Disadvantages:**
❌ Requires authentication setup
❌ Additional API layer latency
❌ Requires v0.100.1+ for API keys

## Upgrade Path

To move from ClickHouse direct access to SigNoz API:

### Step 1: Upgrade SigNoz (Optional)

If using a version older than the one with `SIGNOZ_AUTH_ENABLED` support:

```bash
cd observability/deploy/docker

# Update version in .env or docker-compose.yaml
VERSION=v0.105.0  # Or latest stable

# Pull new images
docker-compose pull

# Restart services
docker-compose up -d
```

### Step 2: Configure Authentication Bypass (v0.105.0+)

If SigNoz supports `SIGNOZ_AUTH_ENABLED`:

```yaml
# observability/deploy/docker/docker-compose.yaml
signoz:
  environment:
    - SIGNOZ_AUTH_ENABLED=false
```

Then update `.env`:

```bash
USE_CLICKHOUSE_DIRECT=false
SIGNOZ_DISABLE_AUTH=true
```

### Step 3: Use API Keys (Recommended)

For production:

1. Enable authentication in SigNoz
2. Create admin user
3. Generate API key
4. Update `.env`:

```bash
USE_CLICKHOUSE_DIRECT=false
SIGNOZ_API_KEY=your-generated-api-key
```

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_CLICKHOUSE_DIRECT` | `true` | Query ClickHouse directly instead of SigNoz API |
| `CLICKHOUSE_URL` | `http://localhost:8124` | ClickHouse HTTP interface URL |
| `CLICKHOUSE_USER` | `default` | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | `` | ClickHouse password |
| `CLICKHOUSE_DATABASE` | `default` | ClickHouse database name |
| `SIGNOZ_URL` | `http://localhost:8080` | SigNoz Query Service URL |
| `SIGNOZ_API_KEY` | `` | SigNoz API key for authentication |
| `SIGNOZ_BEARER_TOKEN` | `` | SigNoz bearer token for authentication |
| `SIGNOZ_DISABLE_AUTH` | `true` | Skip auth headers (for unauthenticated SigNoz) |

## Query Fallback Logic

The observability client uses this fallback sequence:

1. **If `USE_CLICKHOUSE_DIRECT=true` or `SIGNOZ_DISABLE_AUTH=true`:**
   - Try ClickHouse direct query
   - If fails, try SigNoz API (with auth headers if available)
   - If fails, return mock data

2. **If `USE_CLICKHOUSE_DIRECT=false`:**
   - Try SigNoz API (with auth headers if available)
   - If fails, return mock data

## Troubleshooting

### Error: `unauthenticated` from SigNoz API

**Cause:** SigNoz requires authentication but no credentials provided.

**Solutions:**
1. Set `USE_CLICKHOUSE_DIRECT=true` (local dev)
2. Provide `SIGNOZ_API_KEY` or `SIGNOZ_BEARER_TOKEN`
3. Upgrade SigNoz and set `SIGNOZ_AUTH_ENABLED=false`

### Error: Connection refused to ClickHouse

**Cause:** ClickHouse port not exposed or wrong port.

**Solution:**
```bash
# Check if port is exposed
docker ps | grep clickhouse

# Should show: 0.0.0.0:8124->8123/tcp

# If not, update docker-compose.yaml and restart
cd observability/deploy/docker
docker-compose up -d clickhouse
```

### Error: Table doesn't exist in ClickHouse

**Cause:** SigNoz schema not initialized.

**Solution:**
```bash
# Run schema migrator
cd observability/deploy/docker
docker-compose up -d schema-migrator-sync

# Verify tables exist
curl "http://localhost:8124/?query=SHOW+TABLES+FROM+signoz_traces"
```

### Observability UI shows mock data

**Causes:**
- Both ClickHouse and SigNoz queries failed
- No data in ClickHouse yet
- Configuration error

**Debug:**
```bash
# Check if data exists
curl "http://localhost:8124/?query=SELECT+COUNT()+FROM+signoz_traces.signoz_index_v3"

# Check app logs for errors
docker logs supercheck-app | grep observability
```

## Best Practices

### For Local Development
✅ Use `USE_CLICKHOUSE_DIRECT=true`
✅ Keep ClickHouse ports exposed
✅ Monitor ClickHouse disk usage

### For Production
✅ Use SigNoz API with authentication
✅ Set `USE_CLICKHOUSE_DIRECT=false`
✅ Use API keys, not bearer tokens
✅ Restrict ClickHouse network access
✅ Enable TLS for SigNoz API

### For CI/CD
✅ Use environment-specific configs
✅ Inject credentials via secrets
✅ Test with real SigNoz instance, not mocks

## Related Documentation

- [SigNoz Authentication Docs](https://signoz.io/docs/userguide/authentication/)
- [Viewing Data in SigNoz](./VIEWING_DATA_IN_SIGNOZ.md)
- [ClickHouse Queries](./CLICKHOUSE_QUERIES.md)
- [Deployment Guide](./DEPLOYMENT_GUIDE.md)
