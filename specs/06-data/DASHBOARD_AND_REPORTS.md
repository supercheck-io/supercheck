# Dashboard & Reports System

## Overview

The Dashboard & Reports System provides **comprehensive metrics visualization** and **artifact management** for test execution, monitoring, and system health. The system aggregates data from multiple sources to provide real-time insights and historical trends.

---

## Dashboard Architecture

```mermaid
graph TB
    subgraph "📊 Dashboard Components"
        D1[Monitor Metrics<br/>Uptime & Availability]
        D2[Job Statistics<br/>Success/Failure Rates]
        D3[Test Execution<br/>Count by Type]
        D4[Playground Trends<br/>Usage Analytics]
        D5[Queue Health<br/>System Performance]
    end

    subgraph "📈 Data Sources"
        S1[(monitor_results)]
        S2[(jobs.runs)]
        S3[(auditLogs)]
        S4[(Redis Queue Stats)]
    end

    D1 --> S1
    D2 --> S2
    D3 --> S2
    D4 --> S3
    D5 --> S4

    classDef dashboard fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef data fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class D1,D2,D3,D4,D5 dashboard
    class S1,S2,S3,S4 data
```

## Dashboard Metrics

### Monitor Metrics
- **Overall Uptime Percentage** - Last 30 days
- **Availability Trends** - Daily aggregation
- **Average Response Time** - P50, P95, P99
- **Status Distribution** - Up/Down/Degraded counts

### Job Execution Statistics
- **Total Executions** - Last 30 days
- **Success Rate** - Percentage of successful runs
- **Failure Rate** - Percentage of failed runs
- **Average Duration** - Mean execution time

### Test Execution Metrics
- **Playwright Tests** - Execution count
- **K6 Performance Tests** - Execution count
- **Monitor Checks** - Check count

### Playground Analytics
- **Playground Executions** - Tracked via audit logs
- **Usage Trends** - Daily/weekly patterns
- **Popular Templates** - Most used examples

---

## Reports System

### Report Types

```mermaid
graph TB
    subgraph "Report Categories"
        R1[Test Reports<br/>Playwright HTML]
        R2[Job Reports<br/>Aggregated Results]
        R3[Monitor Reports<br/>Check History]
        R4[K6 Reports<br/>Performance Metrics]
    end

    subgraph "Storage"
        S3[(MinIO/S3<br/>Artifact Storage)]
        DB[(PostgreSQL<br/>Metadata)]
    end

    R1 & R2 & R3 & R4 --> S3
    R1 & R2 & R3 & R4 --> DB

    classDef report fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef storage fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class R1,R2,R3,R4 report
    class S3,DB storage
```

### Report Retrieval Flow

```mermaid
sequenceDiagram
    participant User
    participant API as /api/test-results/[...path]
    participant Auth
    participant S3 as MinIO/S3
    participant Cache as Redis Cache

    User->>API: GET /api/test-results/{bucket}/{key}
    API->>Auth: hasPermission("test", "view", projectId)

    alt Authorized
        Auth-->>API: Authorized
        API->>Cache: Check cache

        alt Cache Hit
            Cache-->>API: Cached report
            API-->>User: Report (Cache-Control: 300s)
        else Cache Miss
            Cache-->>API: Not cached
            API->>S3: Fetch report
            S3-->>API: Report content
            API->>Cache: Store in cache (TTL: 5min)
            API-->>User: Report (Cache-Control: 300s)
        end
    else Unauthorized
        Auth-->>API: Forbidden
        API-->>User: 403 Forbidden
    end
```

---

## Report Storage Schema

### Database Schema

```mermaid
erDiagram
    REPORTS {
        uuid id PK
        uuid organizationId FK
        uuid createdByUserId FK
        varchar entityType
        text entityId
        varchar reportPath
        varchar status
        varchar s3Url
        timestamp createdAt
        timestamp updatedAt
    }

    RUNS {
        uuid id PK
        varchar reportS3Url
        varchar logsS3Url
        varchar videoS3Url
    }

    K6_RUNS {
        uuid id PK
        varchar reportS3Url
        varchar summaryS3Url
        varchar consoleS3Url
    }

    REPORTS ||--o{ RUNS : "references"
    REPORTS ||--o{ K6_RUNS : "references"
```

---

## HTML Report Parsing

### Report Components

```mermaid
graph LR
    HTML[HTML Report] --> PARSER[Report Parser]

    PARSER --> META[Metadata<br/>Test count, duration]
    PARSER --> RESULTS[Test Results<br/>Pass/fail status]
    PARSER --> SCREENSHOTS[Screenshots<br/>Failure evidence]
    PARSER --> TRACES[Traces<br/>Execution timeline]
    PARSER --> LOGS[Console Logs<br/>Debug information]

    classDef html fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef component fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class HTML html
    class META,RESULTS,SCREENSHOTS,TRACES,LOGS component
```

---

## Dashboard API

### Endpoint: GET /api/dashboard

**Response Structure:**
```mermaid
graph TB
    RESPONSE[Dashboard Response] --> MONITORS[monitorMetrics]
    RESPONSE --> JOBS[jobStats]
    RESPONSE --> TESTS[testExecutionCounts]
    RESPONSE --> PLAYGROUND[playgroundTrends]
    RESPONSE --> QUEUE[queueStats]

    MONITORS --> M1[overallUptime: 99.5%]
    MONITORS --> M2[totalChecks: 1250]
    MONITORS --> M3[avgResponseTime: 245ms]

    JOBS --> J1[totalRuns: 450]
    JOBS --> J2[successRate: 94.2%]
    JOBS --> J3[failureRate: 5.8%]

    TESTS --> T1[playwrightTests: 320]
    TESTS --> T2[k6Tests: 85]
    TESTS --> T3[monitorChecks: 1250]

    classDef response fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef metric fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class RESPONSE,MONITORS,JOBS,TESTS,PLAYGROUND,QUEUE response
    class M1,M2,M3,J1,J2,J3,T1,T2,T3 metric
```

---

## Performance Optimization

### Caching Strategy

```mermaid
graph TB
    subgraph "Cache Layers"
        C1[Report Cache<br/>TTL: 5 minutes]
        C2[Dashboard Metrics<br/>TTL: 1 minute]
        C3[Query Results<br/>TTL: 30 seconds]
    end

    subgraph "Cache Keys"
        K1[report:{bucket}:{key}]
        K2[dashboard:{orgId}:{projectId}]
        K3[metrics:{type}:{date}]
    end

    C1 --> K1
    C2 --> K2
    C3 --> K3

    classDef cache fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef key fill:#fff3e0,stroke:#f57c00,stroke-width:2px

    class C1,C2,C3 cache
    class K1,K2,K3 key
```

---

## Summary

The Dashboard & Reports System provides:

✅ **Comprehensive Metrics** - All key performance indicators
✅ **Real-Time Updates** - Live dashboard data
✅ **Efficient Caching** - Reduced database and S3 load
✅ **Secure Access** - RBAC-based report retrieval
✅ **Multiple Report Types** - Test, job, monitor, and K6 reports
✅ **Performance Optimization** - Multi-layer caching strategy
