# Supercheck Observability

Integrated observability stack using **ClickHouse + OpenTelemetry** for distributed tracing, logs, and metrics.

## 🚀 Quick Start

Observability is now integrated into the main Supercheck docker-compose.yml!

```bash
# Start entire Supercheck stack (includes observability)
docker-compose up -d

# Start the observability stack (uses official SigNoz setup)
docker compose up -d

# Verify all services are healthy
docker compose ps
```

**Expected output:**
- ✅ `signoz-clickhouse` - healthy
- ✅ `schema-migrator-sync` - exited (completed successfully)
- ✅ `signoz` - healthy (SigNoz query service)
- ✅ `signoz-otel-collector` - running
- ✅ `zookeeper-1` - healthy

**Automatic Schema Initialization**: All required ClickHouse tables are created automatically by SigNoz schema-migrator. No manual steps needed!

## 📦 What's Included

### Services

| Service | Port | Purpose |
|---------|------|---------|
| **ClickHouse** | 8123 (HTTP), 9000 (Native) | Time-series database for storing telemetry |
| **SigNoz Query Service** | 8080 | Query API for traces/logs/metrics |
| **OTel Collector** | 4317 (gRPC), 4318 (HTTP) | Receives and processes telemetry data |

### Databases & Tables

Automatically created by SigNoz schema-migrator on startup:

**signoz_traces**
- `signoz_index_v3`, `signoz_spans`, `signoz_error_index_v2` - Local tables
- `distributed_*` - Distributed tables for cluster compatibility
- `tag_attributes_v2`, `span_attributes_keys` - Metadata tables

**signoz_metrics**
- `samples_v4`, `time_series_v4`, `metadata` - Core metrics storage
- `distributed_*` - Distributed tables for single-node cluster

**signoz_logs**
- `logs`, `tag_attributes_v2` - Log entries with trace correlation
- `distributed_*` - Distributed tables

**signoz_meter**
- `samples_v4`, `time_series_v4` - Usage metrics
- `distributed_*` - Distributed tables

**Data Retention**: 72 hours (configured automatically by schema-migrator)

## 🏗️ Architecture

```
SuperCheck App/Worker
         ↓
  OTel Collector (4318)
         ↓
    ClickHouse
         ↓
  SigNoz Query Service
         ↓
   Next.js API Routes
         ↓
    React UI (shadcn)
```

## ⚙️ Configuration

### Environment Variables

Add to your `.env`:

```bash
# SigNoz Query Service
SIGNOZ_URL=http://localhost:8080

# OTel Collector (for sending telemetry)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

### OpenTelemetry Attributes

Attach these to your spans for proper correlation:

```typescript
{
  "sc.org_id": "org-uuid",
  "sc.project_id": "project-uuid",
  "sc.run_id": "run-uuid",
  "sc.run_type": "playwright" | "k6" | "job" | "monitor",
  "sc.test_name": "Login Flow Test",
  "sc.worker_id": "worker-001"
}
```

## 🧪 Testing

### Health Checks

**Verify all services are responding:**

```bash
# ClickHouse
curl http://localhost:8123/ping

# SigNoz Query Service
curl http://localhost:8080/api/v1/version

# OTel Collector
curl http://localhost:13133/
```

### Send Test Data

**Send a test trace to verify the pipeline:**

```bash
# Send test trace via OTel Collector
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d '{
    "resourceSpans": [{
      "resource": {
        "attributes": [{
          "key": "service.name",
          "value": {"stringValue": "test-service"}
        }]
      },
      "scopeSpans": [{
        "spans": [{
          "traceId": "5b8efff798038103d269b633813fc60c",
          "spanId": "eee19b7ec3c1b174",
          "name": "test-span",
          "startTimeUnixNano": "1544712660000000000",
          "endTimeUnixNano": "1544712661000000000"
        }]
      }]
    }]
  }'

# Verify data in ClickHouse
docker exec signoz-clickhouse clickhouse-client --query \
  "SELECT count(*) FROM signoz_traces.signoz_index_v3"
```

## 🔧 Troubleshooting

### OTel Collector shows "unhealthy"

**This is a known Docker health check quirk - ignore it if:**
- Health endpoint responds: `curl http://localhost:13133/`
- Logs show: "Everything is ready. Begin running and processing data."
- Collector is accepting data on ports 4317/4318

### Schema migrator fails or missing tables

```bash
# Check schema-migrator logs
docker logs schema-migrator-sync

# List all tables
docker exec signoz-clickhouse clickhouse-client --query \
  "SELECT database, name FROM system.tables WHERE database IN ('signoz_traces', 'signoz_metrics', 'signoz_logs') ORDER BY database, name"

# Verify cluster configuration
docker exec signoz-clickhouse clickhouse-client --query \
  "SELECT cluster, shard_num, replica_num FROM system.clusters WHERE cluster = 'cluster'"
```

### No traces appearing

1. Check OTel Collector logs: `docker logs signoz-otel-collector --tail 50`
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
3. Ensure services can reach the collector (network connectivity)
4. Check ClickHouse has data (see "Send Test Data" above)

### Reset everything

```bash
# Navigate to docker directory
cd observability/deploy/docker

# Stop and remove all containers + volumes
docker compose down -v

# Start fresh (schema-migrator will create all tables automatically)
docker compose up -d
```

## 📊 Usage in SuperCheck

### Next.js API Routes

```typescript
// app/src/app/api/observability/traces/search/route.ts
import { signozClient } from '~/lib/observability';

export async function GET(request: Request) {
  const traces = await signozClient.searchTraces({
    start: new Date(Date.now() - 3600000),
    end: new Date(),
    limit: 50
  });

  return Response.json(traces);
}
```

### React Components

```typescript
// app/src/components/observability/TracesList.tsx
import { useTraces } from '~/hooks/useObservability';

export function TracesList() {
  const { data, isLoading } = useTraces({
    timeRange: '1h',
    runType: 'playwright'
  });

  return <div>...</div>;
}
```

## 📁 File Structure

```
observability/
├── deploy/
│   ├── docker/
│   │   ├── docker-compose.yaml        # Main SigNoz stack
│   │   ├── otel-collector-config.yaml # OTel configuration
│   │   └── clickhouse-setup/          # ClickHouse data directory
│   ├── common/
│   │   ├── clickhouse/                # ClickHouse configs
│   │   │   ├── config.xml
│   │   │   ├── users.xml
│   │   │   ├── cluster.xml
│   │   │   └── user_scripts/
│   │   └── signoz/                    # SigNoz configs
│   │       ├── prometheus.yml
│   │       └── otel-collector-opamp-config.yaml
│   └── install.sh                     # Official SigNoz installer
├── DEPLOYMENT_GUIDE.md                # Production deployment guide
└── README.md                          # This file

app/src/
├── app/api/observability/             # API routes
├── app/(main)/observability/          # UI pages
├── hooks/useObservability.ts          # React Query hooks
├── lib/observability/client.ts        # SigNoz client
└── types/observability.ts             # TypeScript types
```

## 🎯 Production Deployment

For production with ClickHouse Cloud:

1. **Create ClickHouse Cloud instance**
   - Sign up at https://clickhouse.cloud/
   - Note connection details (host, port, password)

2. **Update docker-compose**
   ```yaml
   # Comment out clickhouse and schema-init services
   # Update connection strings to point to cloud
   ```

3. **Security**
   - Enable authentication: `SIGNOZ_DISABLE_AUTH=false`
   - Use internal Docker networks
   - Don't expose ClickHouse/OTel ports publicly
   - Use TLS for OTel collector

See official SigNoz docs for clustered deployments.

## 🔍 Key Features

- ✅ **Zero Configuration** - Tables created automatically
- ✅ **Fast Queries** - Optimized ClickHouse indexes
- ✅ **Trace Correlation** - Link traces → logs → metrics
- ✅ **Custom Attributes** - SuperCheck-specific metadata
- ✅ **TTL Management** - Automatic data cleanup after 72h
- ✅ **Single-Node Ready** - Works out-of-the-box for dev/small deployments

## 📚 Resources

- [OpenTelemetry Docs](https://opentelemetry.io/docs/)
- [SigNoz Docs](https://signoz.io/docs/)
- [ClickHouse Docs](https://clickhouse.com/docs/)

---

**Stack**: SigNoz 0.100.1 | ClickHouse 25.5.6 | OTel Collector 0.129.8
