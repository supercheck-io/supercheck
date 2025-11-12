# Observability System Specification

## Overview

Supercheck implements comprehensive observability using **OpenTelemetry** for distributed tracing, **ClickHouse** for data storage, and custom instrumentation for Playwright test execution. The system provides deep visibility into test execution performance, network requests, errors, and system behavior.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [OpenTelemetry Integration](#opentelemetry-integration)
3. [Trace Structure](#trace-structure)
4. [Data Flow](#data-flow)
5. [ClickHouse Storage](#clickhouse-storage)
6. [Custom Attributes](#custom-attributes)
7. [Span Creation](#span-creation)
8. [Playwright Instrumentation](#playwright-instrumentation)
9. [K6 Instrumentation](#k6-instrumentation)
10. [Query API](#query-api)
11. [Frontend Integration](#frontend-integration)
12. [Configuration](#configuration)

## System Architecture

```mermaid
graph TB
    subgraph "⚙️ Worker Service"
        INST[Instrumentation<br/>Must Import First]
        EXEC[Test Execution]
        SPAN[Span Creator]
        PW[Playwright Parser]
        K6[K6 Parser]
    end

    subgraph "📊 OpenTelemetry Stack"
        SDK[OTel SDK]
        EXPORTER[OTLP Exporter<br/>HTTP/gRPC]
        COLLECTOR[OTel Collector<br/>:4317/:4318]
    end

    subgraph "💾 Storage Layer"
        CH[ClickHouse<br/>Port 8123/9000]
        TRACES[(signoz_traces DB)]
        LOGS[(signoz_logs DB)]
    end

    subgraph "🎨 Frontend Layer"
        UI[Observability UI]
        API[Query API]
        FILTERS[Filters & Search]
    end

    INST --> SDK
    EXEC --> SPAN
    SPAN --> PW
    SPAN --> K6
    SPAN --> SDK

    SDK --> EXPORTER
    EXPORTER --> COLLECTOR
    COLLECTOR --> CH
    CH --> TRACES
    CH --> LOGS

    UI --> API
    API --> CH
    FILTERS --> API

    classDef worker fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef otel fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef storage fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef frontend fill:#fff3e0,stroke:#f57c00,stroke-width:2px

    class INST,EXEC,SPAN,PW,K6 worker
    class SDK,EXPORTER,COLLECTOR otel
    class CH,TRACES,LOGS storage
    class UI,API,FILTERS frontend
```

## OpenTelemetry Integration

### Instrumentation Setup

**Critical Rule:** The instrumentation file MUST be imported first before any other code.

**Location:** `worker/src/observability/instrumentation.ts`

**Import Order:**

```mermaid
graph TB
    A[main.ts] -->|1. FIRST IMPORT| B[instrumentation.ts]
    B -->|2. Initialize OTel SDK| C[Configure Exporters]
    C -->|3. Register Providers| D[TraceProvider]
    C -->|4. Register Providers| E[MetricsProvider]
    C -->|5. Register Providers| F[LogsProvider]
    D & E & F -->|6. Ready| G[Import Application Code]
    G --> H[Start NestJS App]

    classDef critical fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef setup fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef app fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class B critical
    class C,D,E,F setup
    class G,H app
```

### SDK Configuration

**Features:**
- Auto-instrumentation: **DISABLED** (prevents internal noise)
- Manual instrumentation: **ENABLED** (high-level operations only)
- Resource detection: Service name, version, environment
- Sampling: 100% (configurable via `OTEL_TRACE_SAMPLE_RATE`)
- Batch span processor: Efficient batching for performance

**Environment Variables:**
- `OTEL_EXPORTER_OTLP_ENDPOINT` - Collector endpoint (http://localhost:4318)
- `OTEL_EXPORTER_OTLP_PROTOCOL` - Protocol (http/grpc)
- `OTEL_SERVICE_NAME` - Service identifier (worker)
- `OTEL_TRACE_SAMPLE_RATE` - Sampling rate (0.0-1.0)

## Trace Structure

### Hierarchy

```mermaid
graph TB
    subgraph "Job Execution Trace"
        JOB[Job Span<br/>sc.job_id: uuid<br/>sc.run_id: uuid<br/>sc.run_type: playwright_job]

        JOB --> TEST1[Test Span 1<br/>sc.test_id: uuid<br/>duration_ms: 2500]
        JOB --> TEST2[Test Span 2<br/>sc.test_id: uuid<br/>duration_ms: 1800]
        JOB --> TEST3[Test Span 3<br/>sc.test_id: uuid<br/>duration_ms: 3200]

        TEST1 --> NET1[HTTP Request Span<br/>GET /api/users]
        TEST1 --> NET2[HTTP Request Span<br/>POST /api/login]
        TEST1 --> ERR1[Error Span<br/>TimeoutError]

        TEST2 --> NET3[HTTP Request Span<br/>GET /dashboard]
        TEST2 --> NET4[HTTP Request Span<br/>GET /api/stats]

        TEST3 --> NET5[HTTP Request Span<br/>POST /api/data]
    end

    classDef job fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef test fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef network fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef error fill:#fff3e0,stroke:#f57c00,stroke-width:2px

    class JOB job
    class TEST1,TEST2,TEST3 test
    class NET1,NET2,NET3,NET4,NET5 network
    class ERR1 error
```

### Span Types

| Span Type | Purpose | Attributes |
|-----------|---------|------------|
| **Job Span** | Top-level job execution | `sc.job_id`, `sc.run_id`, `sc.run_type`, `sc.project_id`, `sc.organization_id` |
| **Test Span** | Individual test execution | `sc.test_id`, `test.name`, `test.status`, `test.duration_ms` |
| **HTTP Span** | Network requests from tests | `http.method`, `http.url`, `http.status_code`, `http.response_time_ms` |
| **Error Span** | Test failures and errors | `error.type`, `error.message`, `error.stack`, `error.screenshot_url` |

## Data Flow

### Complete Observability Pipeline

```mermaid
sequenceDiagram
    participant Worker
    participant OTelSDK
    participant Exporter
    participant Collector
    participant ClickHouse
    participant App
    participant UI

    Note over Worker: Test Execution Starts

    Worker->>Worker: Import instrumentation (FIRST!)
    Worker->>OTelSDK: Initialize SDK
    OTelSDK-->>Worker: SDK Ready

    Worker->>OTelSDK: Start job span
    OTelSDK->>OTelSDK: Create trace context

    loop For each test in job
        Worker->>OTelSDK: Start test span
        Worker->>Worker: Execute Playwright test
        Worker->>Worker: Collect test results
        Worker->>Worker: Parse JSON results
        Worker->>OTelSDK: Create HTTP spans (from network events)
        Worker->>OTelSDK: Create error spans (if failed)
        Worker->>OTelSDK: End test span
    end

    Worker->>OTelSDK: End job span
    OTelSDK->>Exporter: Batch spans
    Exporter->>Collector: OTLP HTTP/gRPC
    Collector->>Collector: Enrich spans
    Collector->>ClickHouse: Insert into signoz_traces
    ClickHouse-->>Collector: Ack

    Note over UI: User Views Traces

    UI->>App: GET /api/observability/traces
    App->>ClickHouse: Query signoz_index_v3
    ClickHouse-->>App: Return trace data
    App->>App: Normalize run_type
    App-->>UI: Display traces

    UI->>App: GET /api/observability/traces/:traceId
    App->>ClickHouse: Query span details
    ClickHouse-->>App: Return span tree
    App-->>UI: Display waterfall
```

## ClickHouse Storage

### Database Schema

**Database:** `signoz_traces`

**Primary Table:** `signoz_traces.signoz_index_v3`

**Key Columns:**
- `timestamp` - Span start time (DateTime64)
- `traceID` - Unique trace identifier (UUID)
- `spanID` - Unique span identifier (UUID)
- `parentSpanID` - Parent span identifier (UUID)
- `serviceName` - Service that created span (String)
- `name` - Span operation name (String)
- `kind` - Span kind (INTERNAL, CLIENT, SERVER, etc.)
- `durationNano` - Span duration in nanoseconds (UInt64)
- `statusCode` - Span status (0=Unset, 1=OK, 2=Error)
- `stringTagMap` - Custom attributes (Map)

### Custom Attribute Storage

```mermaid
graph TB
    A[Span Attributes] --> B[stringTagMap Column]

    B --> C[sc.run_id]
    B --> D[sc.test_id]
    B --> E[sc.job_id]
    B --> F[sc.run_type]
    B --> G[sc.project_id]
    B --> H[sc.organization_id]
    B --> I[sc.service.type]

    J[Indexes] --> K[stringTagMap.sc.run_id]
    J --> L[stringTagMap.sc.test_id]
    J --> M[serviceName]

    classDef attr fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef index fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px

    class C,D,E,F,G,H,I attr
    class K,L,M index
```

### Retention Policy

**Configuration:**
- Default retention: 30 days
- Configurable via ClickHouse TTL settings
- Automatic cleanup of expired data
- Compression for historical data

## Custom Attributes

### Supercheck-Specific Attributes

```mermaid
graph TB
    A[Custom Attributes<br/>Prefix: sc.*] --> B[Run Tracking]
    A --> C[Resource IDs]
    A --> D[Type Classification]
    A --> E[Service Metadata]

    B --> B1[sc.run_id<br/>Unique run identifier]
    B --> B2[sc.run_type<br/>Execution type]

    C --> C1[sc.test_id<br/>Test UUID]
    C --> C2[sc.job_id<br/>Job UUID]
    C --> C3[sc.project_id<br/>Project UUID]
    C --> C4[sc.organization_id<br/>Org UUID]

    D --> D1[playwright_job<br/>Job with multiple tests]
    D --> D2[playwright_test<br/>Single test execution]
    D --> D3[k6_job<br/>K6 performance job]
    D --> D4[k6_test<br/>K6 single test]

    E --> E1[sc.service.type<br/>worker or app]
    E --> E2[sc.version<br/>Service version]

    classDef category fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef attr fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef type fill:#fff3e0,stroke:#f57c00,stroke-width:2px

    class A,B,C,D,E category
    class B1,B2,C1,C2,C3,C4,E1,E2 attr
    class D1,D2,D3,D4 type
```

### Run Type Normalization

The system normalizes granular run types to canonical forms:

**Normalization Map:**
- `playwright_job` → `playwright`
- `playwright_test` → `playwright`
- `playwright_monitor` → `playwright`
- `k6_job` → `k6`
- `k6_test` → `k6`

**Implementation Location:** `app/src/lib/observability/clickhouse-client.ts`

## Span Creation

### Manual Span Creation Helper

**Location:** `worker/src/observability/trace-helpers.ts`

**Function:** `createSpanWithContext(name, attributes, callback)`

**Usage Pattern:**

```mermaid
graph LR
    A[Start Operation] --> B[createSpanWithContext]
    B --> C[Execute Callback]
    C --> D{Success?}
    D -->|Yes| E[Set Status OK]
    D -->|Error| F[Set Status Error]
    E --> G[End Span]
    F --> G
    G --> H[Return Result]

    classDef start fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef process fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef end fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px

    class A,B start
    class C,D process
    class E,F,G,H end
```

### Span Context Propagation

**W3C Trace Context Headers:**
- `traceparent` - Trace ID, span ID, trace flags
- `tracestate` - Vendor-specific trace state

**Propagation Flow:**
```mermaid
graph LR
    A[Worker Span] -->|Extract Context| B[HTTP Headers]
    B -->|Send Request| C[External Service]
    C -->|Continue Trace| D[Remote Span]
    D -->|Return| E[Worker Span]

    classDef worker fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef external fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px

    class A,E worker
    class B,C,D external
```

## Playwright Instrumentation

### Test Result Parsing

**Location:** `worker/src/observability/playwright-test-spans.ts`

**Input:** Playwright JSON results file

**Output:** Tree of spans representing test execution

### Span Creation from Test Results

```mermaid
sequenceDiagram
    participant Playwright
    participant Parser
    participant SpanCreator
    participant OTelSDK

    Playwright->>Playwright: Execute test
    Playwright->>Playwright: Generate JSON results
    Playwright-->>Parser: results.json

    Parser->>Parser: Load JSON file
    Parser->>Parser: Parse test suites

    loop For each test
        Parser->>SpanCreator: Create test span
        SpanCreator->>OTelSDK: Start span

        alt Test has attachments
            Parser->>Parser: Extract screenshots
            Parser->>SpanCreator: Add screenshot URLs
        end

        alt Test has errors
            Parser->>SpanCreator: Create error span
            SpanCreator->>OTelSDK: Add error attributes
        end

        loop Network events
            Parser->>Parser: Parse HAR data
            Parser->>SpanCreator: Create HTTP span
            SpanCreator->>OTelSDK: Add HTTP attributes
        end

        SpanCreator->>OTelSDK: End test span
    end

    OTelSDK->>OTelSDK: Batch spans for export
```

### Network Event Parsing

**Location:** `worker/src/observability/playwright-network-events-parser.ts`

**Features:**
- Extracts HTTP requests from Playwright traces
- Creates child spans for each network call
- Includes timing information (DNS, connect, TLS, transfer)
- Captures request/response headers
- Records status codes and error messages

## K6 Instrumentation

### Performance Test Span Creation

**Location:** `worker/src/observability/k6-test-spans.ts`

**K6 Result Structure:**

```mermaid
graph TB
    A[K6 Job Span] --> B[K6 Test Span]

    B --> C[HTTP Request Metrics]
    B --> D[Check Results]
    B --> E[Threshold Violations]

    C --> C1[http_req_duration<br/>p95: 250ms]
    C --> C2[http_req_failed<br/>rate: 2%]
    C --> C3[http_reqs<br/>count: 10000]

    D --> D1[Login Check<br/>passed: true]
    D --> D2[Response Time<br/>passed: false]

    E --> E1[p95 < 200ms<br/>FAILED]

    classDef job fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef test fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef metric fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef check fill:#fff3e0,stroke:#f57c00,stroke-width:2px

    class A job
    class B test
    class C,C1,C2,C3 metric
    class D,D1,D2,E,E1 check
```

**Attributes Added:**
- `k6.scenario` - Test scenario name
- `k6.vus` - Virtual users count
- `k6.iterations` - Total iterations
- `k6.duration` - Test duration
- `k6.threshold.passed` - Threshold pass/fail status
- `k6.metric.*` - Individual metric values

## Query API

### API Endpoints

**Trace Queries:**
- `GET /api/observability/traces` - List traces with filters
- `GET /api/observability/traces/:traceId` - Get trace details
- `GET /api/observability/runs/:runId/traces` - Get traces for run

**Filter Parameters:**
- `runId` - Filter by run UUID
- `testId` - Filter by test UUID
- `jobId` - Filter by job UUID
- `projectId` - Filter by project UUID
- `runType` - Filter by run type (normalized)
- `serviceName` - Filter by service name
- `status` - Filter by status (success/error)
- `startTime` - Time range start
- `endTime` - Time range end

### Query Flow

```mermaid
sequenceDiagram
    participant UI
    participant API
    participant ClickHouse

    UI->>API: GET /api/observability/traces?runId=uuid

    API->>API: Build ClickHouse query
    API->>API: Apply filters
    API->>API: Add normalization

    API->>ClickHouse: SELECT FROM signoz_index_v3

    Note over ClickHouse: WHERE stringTagMap['sc.run_id'] = 'uuid'<br/>AND timestamp >= startTime<br/>AND timestamp <= endTime

    ClickHouse-->>API: Return spans

    API->>API: Normalize run_type values
    API->>API: Build span tree
    API->>API: Calculate durations

    API-->>UI: Return trace data

    UI->>UI: Render waterfall chart
```

### Direct ClickHouse Queries

**Implementation:** Bypasses SigNoz query service for better performance

**Query Example Structure:**
```
SELECT
    traceID,
    spanID,
    parentSpanID,
    serviceName,
    name,
    timestamp,
    durationNano,
    statusCode,
    stringTagMap['sc.run_id'] as runId,
    stringTagMap['sc.test_id'] as testId,
    stringTagMap['sc.run_type'] as runType
FROM signoz_traces.signoz_index_v3
WHERE stringTagMap['sc.run_id'] = {runId}
ORDER BY timestamp ASC
```

## Frontend Integration

### Observability UI

**Location:** `app/src/app/(main)/observability/`

**Features:**
- Trace list view with filtering
- Trace detail view with span waterfall
- Log viewer with level filtering
- Service map visualization
- Metrics dashboard

### Trace Waterfall Visualization

```mermaid
gantt
    title Test Execution Trace Waterfall
    dateFormat X
    axisFormat %L ms

    section Job Span
    Job Execution :0, 5000

    section Test 1
    Test Execution :0, 2500
    HTTP GET /api/users :100, 300
    HTTP POST /api/login :400, 700
    Error: Timeout :2400, 2500

    section Test 2
    Test Execution :2600, 4400
    HTTP GET /dashboard :2700, 3000
    HTTP GET /api/stats :3100, 3500

    section Test 3
    Test Execution :4500, 7700
    HTTP POST /api/data :4600, 5200
```

### React Components

**Key Components:**
- `TraceList` - Displays trace results in table
- `TraceDetails` - Shows span tree with waterfall
- `SpanDetails` - Individual span information
- `TraceFilters` - Filter UI for queries
- `ServiceMap` - Visual service dependencies

## Configuration

### Environment Variables

**Worker Service:**
```
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http
OTEL_SERVICE_NAME=worker
OTEL_TRACE_SAMPLE_RATE=1.0
OTEL_LOGS_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
```

**OTel Collector:**
```
OTEL_COLLECTOR_ENDPOINT=http://otel-collector:4318
CLICKHOUSE_ENDPOINT=http://clickhouse:8123
CLICKHOUSE_DATABASE=signoz_traces
```

**ClickHouse:**
```
CLICKHOUSE_HTTP_PORT=8123
CLICKHOUSE_NATIVE_PORT=9000
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=<secure-password>
```

### Deployment Architecture

```mermaid
graph TB
    subgraph "Docker Compose Services"
        WORKER[Worker Service<br/>:3001]
        APP[App Service<br/>:3000]
        COLLECTOR[OTel Collector<br/>:4317/:4318]
        CH[ClickHouse<br/>:8123/:9000]
        SCHEMA[Schema Migrator<br/>One-time setup]
    end

    WORKER -->|OTLP Export| COLLECTOR
    APP -->|Query| CH
    COLLECTOR -->|Insert Spans| CH
    SCHEMA -->|Create Tables| CH

    classDef service fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef otel fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef storage fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class WORKER,APP service
    class COLLECTOR,SCHEMA otel
    class CH storage
```

## Best Practices

### Span Creation Guidelines

**DO:**
- Import instrumentation FIRST in main.ts
- Use manual spans for high-level operations only
- Add meaningful custom attributes
- Set appropriate span statuses (OK/ERROR)
- Include error details in error spans
- Propagate context across async boundaries

**DON'T:**
- Auto-instrument internal operations (creates noise)
- Create spans for database queries (too granular)
- Create spans for every function call
- Forget to end spans (memory leak)
- Block on span export (use async export)

### Performance Considerations

**Optimization Strategies:**
- Batch span export (default: 2048 spans)
- Use sampling in high-traffic scenarios
- Index custom attributes in ClickHouse
- Implement data retention policies
- Compress historical trace data
- Use materialized views for common queries

### Security Considerations

**Data Protection:**
- Sanitize sensitive data from spans
- Use separate ClickHouse user for queries
- Restrict access to trace data by project
- Implement RBAC for observability UI
- Audit access to sensitive traces
- Encrypt data in transit and at rest

## Testing Guide

### Verify Instrumentation

**Steps:**
1. Start worker service
2. Check logs for OTel initialization
3. Execute a test
4. Query ClickHouse for trace data
5. Verify spans created with correct attributes

**ClickHouse Verification Query:**
```sql
SELECT
    traceID,
    spanID,
    name,
    serviceName,
    stringTagMap['sc.run_id'] as runId
FROM signoz_traces.signoz_index_v3
WHERE serviceName = 'worker'
ORDER BY timestamp DESC
LIMIT 10
```

### Test Span Creation

**Unit Test Pattern:**
1. Mock OTel SDK
2. Execute operation
3. Verify span started
4. Verify attributes set
5. Verify span ended
6. Verify status set correctly

## Related Documentation

- **Test Execution:** See `TEST_EXECUTION_AND_JOB_QUEUE_FLOW.md`
- **Worker Service:** See `SUPERCHECK_ARCHITECTURE.md`
- **Database Schema:** See `ERD_DIAGRAM.md`
- **API Routes:** See `API_ROUTES_ANALYSIS.md`

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-12 | Initial observability specification |
