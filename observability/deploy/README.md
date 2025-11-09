# Observability Configuration

This directory contains essential configuration files for Supercheck's observability stack (SigNoz + ClickHouse + OpenTelemetry).

## Directory Structure

```
observability/deploy/
├── common/clickhouse/          # ClickHouse database configuration
│   ├── config.xml              # Main ClickHouse server configuration
│   ├── users.xml               # User authentication and permissions
│   ├── custom-function.xml     # Custom function definitions
│   ├── cluster-standalone.xml  # Single-node cluster config (no Zookeeper)
│   └── user_scripts/           # User-defined functions (UDFs)
│       └── histogramQuantile   # Quantile calculation for metrics
└── docker/
    └── otel-collector-config.yaml  # OpenTelemetry Collector pipelines

```

## Configuration Files

### ClickHouse Configuration

**config.xml**
- Main ClickHouse server configuration
- Network settings, logging, query settings
- Memory and performance tuning
- Used by: `clickhouse-observability` service

**users.xml**
- User authentication (default user with no password for local dev)
- Query permissions and quotas
- For production: Set CLICKHOUSE_PASSWORD environment variable

**custom-function.xml**
- Custom SQL functions for trace/metric queries
- Required by SigNoz schema

**cluster-standalone.xml**
- Single-node cluster configuration
- No Zookeeper required (development setup)
- Mounted as `/etc/clickhouse-server/config.d/cluster.xml`

**user_scripts/histogramQuantile**
- Custom UDF for calculating histogram quantiles
- Used in metric aggregation queries

### OpenTelemetry Collector Configuration

**otel-collector-config.yaml**
- Defines telemetry data pipelines:
  - **Receivers**: OTLP gRPC (4317), OTLP HTTP (4318), Prometheus
  - **Processors**: Batch processing, resource detection, span metrics
  - **Exporters**: ClickHouse (traces, logs, metrics)
- Used by: `otel-collector` service

## How It Works

1. **Application/Test sends traces** → OTel Collector (port 4317/4318)
2. **OTel Collector processes** → Batching, enrichment, span metrics
3. **Data exported to ClickHouse** → Stored in signoz_traces, signoz_logs, signoz_metrics
4. **Supercheck UI queries ClickHouse** → Displays observability data

## Mounted in docker-compose.yml

These files are mounted read-only into the respective containers:

```yaml
clickhouse-observability:
  volumes:
    - ./observability/deploy/common/clickhouse/config.xml:/etc/clickhouse-server/config.xml:ro
    - ./observability/deploy/common/clickhouse/users.xml:/etc/clickhouse-server/users.xml:ro
    - ./observability/deploy/common/clickhouse/custom-function.xml:/etc/clickhouse-server/custom-function.xml:ro
    - ./observability/deploy/common/clickhouse/cluster-standalone.xml:/etc/clickhouse-server/config.d/cluster.xml:ro
    - ./observability/deploy/common/clickhouse/user_scripts:/var/lib/clickhouse/user_scripts:ro

otel-collector:
  volumes:
    - ./observability/deploy/docker/otel-collector-config.yaml:/etc/otel/config.yaml:ro
```

## Customization

### For Production Deployments

1. **Enable ClickHouse authentication:**
   - Set `CLICKHOUSE_PASSWORD` environment variable
   - Update `users.xml` to require password

2. **High availability (multiple nodes):**
   - Replace `cluster-standalone.xml` with `cluster.xml`
   - Add Zookeeper service for coordination
   - Scale ClickHouse to 3+ nodes

3. **Resource tuning:**
   - Adjust ClickHouse memory limits in `config.xml`
   - Tune OTel Collector batch sizes in `otel-collector-config.yaml`

4. **Data retention:**
   - Configure TTL policies in ClickHouse
   - Set up automated cleanup jobs

### For Development

Current configuration is optimized for local development:
- Single ClickHouse node (no Zookeeper)
- No authentication (empty password)
- Ports exposed for debugging
- Moderate resource limits

## Troubleshooting

**ClickHouse won't start:**
- Check logs: `docker-compose logs clickhouse-observability`
- Verify config syntax: XML must be well-formed
- Check file permissions: Must be readable

**OTel Collector errors:**
- Check logs: `docker-compose logs otel-collector`
- Verify ClickHouse is healthy first
- Test endpoints: `curl http://localhost:4318/v1/traces`

**Schema migration fails:**
- Ensure `cluster-standalone.xml` is mounted correctly
- Check schema-migrator logs: `docker-compose logs schema-migrator`
- Verify ClickHouse cluster config matches migrator expectations

## Documentation

For complete setup and usage instructions, see:
- [OBSERVABILITY_SETUP.md](../../OBSERVABILITY_SETUP.md) - Setup guide
- [OBSERVABILITY_INSTRUMENTATION.md](../../OBSERVABILITY_INSTRUMENTATION.md) - How to instrument apps
- [OBSERVABILITY_TESTING.md](../../OBSERVABILITY_TESTING.md) - Testing guide

## Support

For issues or questions:
- Check troubleshooting section in OBSERVABILITY_SETUP.md
- Review docker-compose.yml service dependencies
- Verify all services are healthy: `docker-compose ps`
