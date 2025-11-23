# Storage System - S3/MinIO Architecture

## Overview

The Supercheck storage system manages artifact storage using **MinIO** (S3-compatible object storage) for test reports, traces, screenshots, videos, and performance metrics. The system provides **secure access control**, **presigned URL generation**, and **automated bucket management** for distributed artifact storage.

**🔒 Security-First Design:** All artifact access is authenticated through a proxy layer with role-based access control. Direct S3 access is restricted to worker services only.

**📦 Multi-Bucket Strategy:** Artifacts are organized across 5 specialized buckets based on execution type for optimal organization and lifecycle management.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Bucket Organization](#bucket-organization)
3. [S3 Client Configuration](#s3-client-configuration)
4. [Upload Flows](#upload-flows)
5. [Access Patterns](#access-patterns)
6. [Presigned URL Generation](#presigned-url-generation)
7. [Security & Access Control](#security--access-control)
8. [Performance Optimization](#performance-optimization)
9. [Lifecycle Management](#lifecycle-management)
10. [Monitoring & Observability](#monitoring--observability)

---

## System Architecture

### Complete Storage Architecture

```mermaid
graph TB
    subgraph "🎨 Client Layer"
        USER[User Browser]
        WORKER[Worker Services]
    end

    subgraph "🔐 Access Layer"
        API[API Proxy<br/>/api/test-results]
        AUTH[Authorization<br/>hasPermission]
        PRESIGN[Presigned URL Generator]
    end

    subgraph "💾 Storage Layer - MinIO/S3"
        S3CLIENT[S3 Service<br/>AWS SDK v3]

        subgraph "Buckets"
            B1[playwright-test-artifacts<br/>Single Tests]
            B2[playwright-job-artifacts<br/>Multi-Test Jobs]
            B3[playwright-monitor-artifacts<br/>Monitor Checks]
            B4[supercheck-performance-artifacts<br/>K6 Load Tests]
            B5[supercheck-status-artifacts<br/>Status Pages]
        end
    end

    subgraph "🗄️ Metadata Layer"
        DB[(PostgreSQL<br/>reports table<br/>k6PerformanceRuns<br/>runs table)]
    end

    USER -->|View Report| API
    API --> AUTH
    AUTH -->|Authorized| PRESIGN
    PRESIGN --> S3CLIENT

    WORKER -->|Upload Artifacts| S3CLIENT
    S3CLIENT --> B1 & B2 & B3 & B4 & B5

    B1 & B2 & B3 & B4 & B5 -.->|Store URLs| DB

    S3CLIENT -.->|Read| B1 & B2 & B3 & B4 & B5

    classDef client fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef access fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef storage fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef metadata fill:#fff3e0,stroke:#f57c00,stroke-width:2px

    class USER,WORKER client
    class API,AUTH,PRESIGN access
    class S3CLIENT,B1,B2,B3,B4,B5 storage
    class DB metadata
```

### Data Flow Overview

```mermaid
sequenceDiagram
    participant Worker
    participant S3
    participant DB
    participant User
    participant Proxy

    Note over Worker,DB: Upload Phase
    Worker->>Worker: Execute test & generate artifacts
    Worker->>S3: Upload HTML report
    Worker->>S3: Upload screenshots/videos
    Worker->>S3: Upload trace files
    S3-->>Worker: S3 URLs
    Worker->>DB: Save S3 URLs to database

    Note over User,Proxy: Access Phase
    User->>Proxy: Request report
    Proxy->>DB: Fetch report metadata
    DB-->>Proxy: S3 URL & permissions
    Proxy->>Proxy: Check authorization
    Proxy->>S3: Fetch artifact
    S3-->>Proxy: Artifact content
    Proxy-->>User: Serve artifact (with cache headers)
```

---

## Bucket Organization

### Bucket Structure & Purpose

```mermaid
graph TB
    subgraph "MinIO Storage - 5 Specialized Buckets"
        B1["playwright-test-artifacts<br/>Single Test Executions"]
        B2["playwright-job-artifacts<br/>Multi-Test Job Runs"]
        B3["playwright-monitor-artifacts<br/>Health Check Results"]
        B4["supercheck-performance-artifacts<br/>K6 Load Test Results"]
        B5["supercheck-status-artifacts<br/>Status Page Assets"]
    end

    subgraph "Path Organization"
        P1["B1: {testId}/report/index.html"]
        P2["B2: {runId}/report/index.html"]
        P3["B3: {uniqueRunId}/report/index.html"]
        P4["B4: {runId}/summary.json<br/>{runId}/metrics.json<br/>{runId}/index.html"]
        P5["B5: {statusPageId}/logo.png<br/>{statusPageId}/hero.jpg"]
    end

    B1 --> P1
    B2 --> P2
    B3 --> P3
    B4 --> P4
    B5 --> P5

    classDef bucket fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef path fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class B1,B2,B3,B4,B5 bucket
    class P1,P2,P3,P4,P5 path
```

### Bucket Details

| Bucket Name | Purpose | Path Pattern | Typical Files |
|-------------|---------|--------------|---------------|
| `playwright-test-artifacts` | Single test execution | `{testId}/report/*` | index.html, screenshots, traces |
| `playwright-job-artifacts` | Multi-test job runs | `{runId}/report/*` | index.html, aggregated reports |
| `playwright-monitor-artifacts` | Health check results | `{uniqueRunId}/report/*` | index.html, check logs (unique IDs preserve history) |
| `supercheck-performance-artifacts` | K6 load tests | `{runId}/*` | summary.json, metrics.json, index.html, console.log |
| `supercheck-status-artifacts` | Status page assets | `{statusPageId}/*` | logos, hero images, custom assets |

### Artifact Types & Locations

```mermaid
graph LR
    subgraph "Artifact Types"
        A1[HTML Reports]
        A2[Screenshots - PNG/JPEG]
        A3[Videos - WebM]
        A4[Trace Files - ZIP]
        A5[Console Logs - TXT]
        A6[K6 Metrics - JSON]
        A7[Status Page Assets - Images]
    end

    subgraph "Storage Destinations"
        D1[Test Artifacts Bucket]
        D2[Job Artifacts Bucket]
        D3[Monitor Artifacts Bucket]
        D4[Performance Artifacts Bucket]
        D5[Status Artifacts Bucket]
    end

    A1 --> D1 & D2 & D3 & D4
    A2 --> D1 & D2 & D3
    A3 --> D1 & D2
    A4 --> D1 & D2 & D3
    A5 --> D1 & D2 & D3 & D4
    A6 --> D4
    A7 --> D5

    classDef artifact fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef destination fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class A1,A2,A3,A4,A5,A6,A7 artifact
    class D1,D2,D3,D4,D5 destination
```

---

## S3 Client Configuration

### Client Initialization

```mermaid
graph TB
    A[S3 Service Module] --> B[AWS SDK v3 Client]
    B --> C[Configuration]

    C --> C1["Credentials<br/>minioadmin/minioadmin"]
    C --> C2["Endpoint<br/>http://minio:9000"]
    C --> C3["Region<br/>us-east-1"]
    C --> C4["Force Path Style<br/>true (MinIO requirement)"]

    A --> D[Bucket Initialization]
    D --> E{Bucket Exists?}
    E -->|No| F[Create Bucket]
    E -->|Yes| G[Ready]
    F --> H{Success?}
    H -->|No| I[Retry with Backoff]
    H -->|Yes| G
    I --> E

    classDef config fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef process fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef result fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class C1,C2,C3,C4 config
    class D,E,F,H,I process
    class G result
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AWS_ACCESS_KEY_ID` | `minioadmin` | MinIO access key |
| `AWS_SECRET_ACCESS_KEY` | `minioadmin` | MinIO secret key |
| `S3_ENDPOINT` | `http://minio:9000` | MinIO endpoint URL |
| `S3_REGION` | `us-east-1` | S3 region (MinIO compatibility) |
| `PLAYWRIGHT_TEST_BUCKET` | `playwright-test-artifacts` | Test artifacts bucket |
| `PLAYWRIGHT_JOB_BUCKET` | `playwright-job-artifacts` | Job artifacts bucket |
| `PLAYWRIGHT_MONITOR_BUCKET` | `playwright-monitor-artifacts` | Monitor artifacts bucket |
| `K6_BUCKET` | `supercheck-performance-artifacts` | K6 performance bucket |
| `STATUS_BUCKET` | `supercheck-status-artifacts` | Status page assets bucket |

### Retry Strategy

```mermaid
stateDiagram-v2
    [*] --> AttemptUpload: Initial Upload
    AttemptUpload --> Success: Upload Successful
    AttemptUpload --> Failed: Network/Connection Error
    Failed --> Retry1: Wait 100ms
    Retry1 --> Success: Upload Successful
    Retry1 --> Retry2: Still Failing (Wait 200ms)
    Retry2 --> Success: Upload Successful
    Retry2 --> Retry3: Still Failing (Wait 400ms)
    Retry3 --> Success: Upload Successful
    Retry3 --> Permanent_Failure: Max Retries Exceeded
    Success --> [*]
    Permanent_Failure --> [*]

    note right of Failed
        Exponential backoff
        100ms * 2^attempt
        Max 3 attempts
    end note
```

---

## Upload Flows

### Test Execution Upload Flow

```mermaid
sequenceDiagram
    participant Test as Test Executor
    participant Worker as Worker Service
    participant S3 as S3 Service
    participant MinIO as MinIO Storage
    participant DB as Database

    Test->>Test: Execute test in container
    Test->>Test: Generate HTML report
    Test->>Test: Capture screenshots
    Test->>Test: Record trace

    Test->>Worker: Execution complete
    Worker->>Worker: Extract artifacts from container

    Worker->>S3: uploadTestReport(testId, reportPath)
    S3->>MinIO: PUT playwright-test-artifacts/{testId}/report/index.html
    MinIO-->>S3: S3 URL

    Worker->>S3: uploadArtifacts(testId, screenshots)
    S3->>MinIO: PUT playwright-test-artifacts/{testId}/report/screenshots/*
    MinIO-->>S3: S3 URLs

    Worker->>S3: uploadTraceFile(testId, trace)
    S3->>MinIO: PUT playwright-test-artifacts/{testId}/report/trace.zip
    MinIO-->>S3: S3 URL

    S3-->>Worker: All S3 URLs
    Worker->>DB: Save S3 URLs to runs table
    DB-->>Worker: Saved
```

### Job Execution Upload Flow

```mermaid
sequenceDiagram
    participant Job as Job Executor
    participant Worker as Worker Service
    participant S3 as S3 Service
    participant MinIO as MinIO Storage
    participant DB as Database

    Job->>Job: Execute all tests sequentially
    Job->>Job: Aggregate results
    Job->>Job: Generate combined report

    Job->>Worker: All tests complete
    Worker->>S3: uploadJobReport(runId, reportPath)
    S3->>MinIO: PUT playwright-job-artifacts/{runId}/report/index.html
    MinIO-->>S3: S3 URL (reportS3Url)

    Worker->>S3: uploadJobLogs(runId, logsPath)
    S3->>MinIO: PUT playwright-job-artifacts/{runId}/logs.txt
    MinIO-->>S3: S3 URL (logsS3Url)

    alt Video Recording Enabled
        Worker->>S3: uploadJobVideo(runId, videoPath)
        S3->>MinIO: PUT playwright-job-artifacts/{runId}/video.webm
        MinIO-->>S3: S3 URL (videoS3Url)
    end

    S3-->>Worker: All S3 URLs
    Worker->>DB: Update run record with S3 URLs
    DB-->>Worker: Updated
```

### K6 Performance Upload Flow

```mermaid
sequenceDiagram
    participant K6 as K6 Executor
    participant Worker as Worker Service
    participant S3 as S3 Service
    participant MinIO as MinIO Storage
    participant DB as Database

    K6->>K6: Execute load test
    K6->>K6: Generate summary.json
    K6->>K6: Generate metrics.json
    K6->>K6: Generate index.html
    K6->>K6: Capture console output

    K6->>Worker: Test complete

    Worker->>S3: uploadK6Summary(runId, summaryPath)
    S3->>MinIO: PUT supercheck-performance-artifacts/{runId}/summary.json
    MinIO-->>S3: summaryS3Url

    Worker->>S3: uploadK6Report(runId, reportPath)
    S3->>MinIO: PUT supercheck-performance-artifacts/{runId}/index.html
    MinIO-->>S3: reportS3Url

    Worker->>S3: uploadK6Console(runId, consolePath)
    S3->>MinIO: PUT supercheck-performance-artifacts/{runId}/console.log
    MinIO-->>S3: consoleS3Url

    S3-->>Worker: All S3 URLs
    Worker->>DB: Save to k6PerformanceRuns table
    DB-->>Worker: Saved
```

### Monitor Execution Upload Flow

```mermaid
sequenceDiagram
    participant Monitor as Monitor Executor
    participant Worker as Worker Service
    participant S3 as S3 Service
    participant MinIO as MinIO Storage
    participant DB as Database

    Note over Monitor: Uses unique run ID to preserve history

    Monitor->>Monitor: Execute health check
    Monitor->>Monitor: Generate report

    Monitor->>Worker: Check complete
    Worker->>Worker: Generate uniqueRunId

    Worker->>S3: uploadMonitorReport(uniqueRunId, reportPath)
    S3->>MinIO: PUT playwright-monitor-artifacts/{uniqueRunId}/report/index.html
    MinIO-->>S3: S3 URL

    Worker->>S3: uploadMonitorLogs(uniqueRunId, logsPath)
    S3->>MinIO: PUT playwright-monitor-artifacts/{uniqueRunId}/report/logs.txt
    MinIO-->>S3: S3 URL

    S3-->>Worker: All S3 URLs
    Worker->>DB: Save to monitor_results table
    DB-->>Worker: Saved

    Note over DB: Unique IDs ensure historical results are never overwritten
```

---

## Access Patterns

### User Access via Proxy

```mermaid
sequenceDiagram
    participant User
    participant Browser
    participant API as /api/test-results/[...path]
    participant Auth as Authorization Service
    participant DB as Database
    participant S3 as S3 Service
    participant MinIO as MinIO Storage

    User->>Browser: Click "View Report"
    Browser->>API: GET /api/test-results/{bucket}/{key}

    API->>DB: Fetch report metadata
    DB-->>API: Report details + projectId

    API->>Auth: hasPermission("test", "view", projectId)

    alt Authorized
        Auth-->>API: Authorized
        API->>S3: getObject(bucket, key)
        S3->>MinIO: Fetch object
        MinIO-->>S3: Object content
        S3-->>API: Artifact data
        API-->>Browser: Serve artifact (Cache-Control: 300s)
        Browser-->>User: Display report
    else Not Authorized
        Auth-->>API: Unauthorized
        API-->>Browser: 403 Forbidden
        Browser-->>User: Access Denied
    end
```

### Direct Worker Access

```mermaid
sequenceDiagram
    participant Worker
    participant S3 as S3 Service
    participant MinIO

    Note over Worker,MinIO: Workers have direct S3 API access

    Worker->>S3: putObject(bucket, key, data)
    S3->>MinIO: Store object
    MinIO-->>S3: Success + ETag
    S3-->>Worker: S3 URL

    Note over Worker,MinIO: No proxy layer for workers - direct authenticated access
```

---

## Presigned URL Generation

### Presigned URL Architecture

```mermaid
graph TB
    A[Request Presigned URL] --> B[Fetch Report Metadata]
    B --> C{Authorized?}

    C -->|No| D[403 Forbidden]
    C -->|Yes| E[Generate Presigned URL]

    E --> F[AWS SDK getSignedUrl]
    F --> G[S3 GetObjectCommand]
    G --> H["Expiration: 7 days<br/>(604800 seconds)"]

    H --> I[Presigned URL]
    I --> J[User Access via URL]
    J --> K{URL Valid?}
    K -->|Yes| L[MinIO Serves Object]
    K -->|No| M[403 Expired/Invalid]

    classDef auth fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef process fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef result fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class C,D,M auth
    class A,B,E,F,G,H,J,K process
    class I,L result
```

### Presigned URL Flow

```mermaid
sequenceDiagram
    participant User
    participant API as /api/presigned-url
    participant Auth as Authorization
    participant DB as Database
    participant S3 as S3 Presigned Service
    participant MinIO

    User->>API: POST /api/presigned-url<br/>{bucket, key}
    API->>DB: Fetch artifact metadata
    DB-->>API: Metadata + projectId

    API->>Auth: hasPermission("test", "view", projectId)

    alt Authorized
        Auth-->>API: Authorized
        API->>S3: generatePresignedUrl(bucket, key, 604800)
        S3->>S3: Create GetObjectCommand
        S3->>S3: Sign URL with AWS credentials
        S3-->>API: Presigned URL
        API-->>User: {url, expiresIn: 7 days}

        Note over User,MinIO: User can now access URL directly
        User->>MinIO: GET presigned URL
        MinIO->>MinIO: Validate signature
        MinIO-->>User: Artifact content
    else Not Authorized
        Auth-->>API: Unauthorized
        API-->>User: 403 Forbidden
    end
```

### Batch Presigned URL Generation

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant S3 as S3 Presigned Service

    Client->>API: POST /api/presigned-urls<br/>[{bucket, key}, ...]

    loop For each artifact
        API->>API: Check authorization
        API->>S3: generatePresignedUrl(bucket, key)
        S3-->>API: Presigned URL
    end

    API-->>Client: Array of presigned URLs

    Note over Client,API: Efficient for bulk downloads<br/>(e.g., all screenshots)
```

---

## Security & Access Control

### Security Layers

```mermaid
graph TB
    subgraph "🛡️ Security Architecture"
        L1[Network Isolation<br/>MinIO on internal Docker network]
        L2[Authentication<br/>Better Auth sessions]
        L3[Authorization<br/>RBAC hasPermission checks]
        L4[Presigned URLs<br/>Time-limited access tokens]
        L5[Proxy Layer<br/>No direct MinIO exposure]
    end

    subgraph "Access Paths"
        A1[Worker → Direct S3 API]
        A2[User → Proxy → S3]
        A3[User → Presigned URL → MinIO]
    end

    L1 --> L2 --> L3 --> L4 --> L5

    L5 -.-> A1 & A2 & A3

    classDef security fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef access fill:#e3f2fd,stroke:#1976d2,stroke-width:2px

    class L1,L2,L3,L4,L5 security
    class A1,A2,A3 access
```

### Authorization Flow

```mermaid
sequenceDiagram
    participant User
    participant Proxy
    participant DB
    participant Auth as RBAC Service

    User->>Proxy: Request artifact
    Proxy->>DB: Fetch artifact metadata
    DB-->>Proxy: {projectId, organizationId}

    Proxy->>Auth: hasPermission("test", "view", projectId)
    Auth->>Auth: Check user's project role

    alt User is project_viewer or higher
        Auth-->>Proxy: Authorized
        Proxy->>Proxy: Serve artifact
    else User is not project member
        Auth-->>Proxy: Unauthorized
        Proxy-->>User: 403 Forbidden
    end
```

### Network Security

```mermaid
graph TB
    subgraph "Public Internet"
        USER[Users]
    end

    subgraph "Docker Network - supercheck-network"
        APP[Next.js App<br/>:3000]
        WORKER[Worker Service<br/>:3001]
        MINIO[MinIO<br/>:9000 (internal only)]
    end

    subgraph "External Access"
        TRAEFIK[Traefik Proxy<br/>:443]
    end

    USER -->|HTTPS| TRAEFIK
    TRAEFIK --> APP
    APP -->|S3 API| MINIO
    WORKER -->|S3 API| MINIO

    Note[MinIO is NOT exposed<br/>to public internet]

    classDef public fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef internal fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef proxy fill:#e3f2fd,stroke:#1976d2,stroke-width:2px

    class USER public
    class APP,WORKER,MINIO internal
    class TRAEFIK proxy
```

---

## Performance Optimization

### Caching Strategy

```mermaid
graph TB
    A[User Request] --> B{Cache Hit?}

    B -->|Yes| C[Serve from Cache<br/>Cache-Control: 300s]
    B -->|No| D[Fetch from MinIO]

    D --> E[Store in Cache]
    E --> F[Serve to User]

    F --> G[Set Cache Headers<br/>max-age=300]

    G --> H{Next Request<br/>Within 5 min?}
    H -->|Yes| B
    H -->|No| I[Cache Expired]
    I --> D

    classDef cache fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef fetch fill:#fff3e0,stroke:#f57c00,stroke-width:2px

    class B,C,E,G,H cache
    class D,F,I fetch
```

### Upload Optimization

```mermaid
graph LR
    A[Generate Artifacts] --> B{File Size}

    B -->|< 5MB| C[Single Upload]
    B -->|> 5MB| D[Multipart Upload]

    C --> E[Standard PutObject]
    D --> F[CreateMultipartUpload]
    F --> G[UploadPart - Parallel]
    G --> H[CompleteMultipartUpload]

    E --> I[S3 URL]
    H --> I

    classDef small fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef large fill:#fff3e0,stroke:#f57c00,stroke-width:2px

    class A,B,C,E small
    class D,F,G,H large
```

### Connection Pooling

- AWS SDK v3 maintains connection pool
- Reuses HTTP connections for multiple requests
- Reduces connection overhead
- Configurable via `maxSockets` option

---

## Lifecycle Management

### Retention Policies

```mermaid
graph TB
    subgraph "Retention Strategy"
        R1[Test Artifacts<br/>30 days]
        R2[Job Artifacts<br/>90 days]
        R3[Monitor Artifacts<br/>7 days]
        R4[K6 Performance<br/>60 days]
        R5[Status Assets<br/>Indefinite]
    end

    subgraph "Cleanup Process"
        C1[Data Lifecycle Worker]
        C2[Scan Buckets Daily]
        C3[Identify Expired Objects]
        C4[Delete Objects]
        C5[Update Database]
    end

    R1 & R2 & R3 & R4 --> C1
    C1 --> C2 --> C3 --> C4 --> C5

    classDef retention fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef cleanup fill:#fff3e0,stroke:#f57c00,stroke-width:2px

    class R1,R2,R3,R4,R5 retention
    class C1,C2,C3,C4,C5 cleanup
```

### Cleanup Flow

```mermaid
sequenceDiagram
    participant Scheduler
    participant Worker as Cleanup Worker
    participant DB as Database
    participant S3 as S3 Service
    participant MinIO

    Scheduler->>Worker: Trigger daily cleanup (cron)
    Worker->>DB: Query expired artifacts
    DB-->>Worker: List of expired S3 URLs

    loop For each expired artifact
        Worker->>S3: deleteObject(bucket, key)
        S3->>MinIO: Delete object
        MinIO-->>S3: Deleted
        S3-->>Worker: Success
        Worker->>DB: Mark artifact as deleted
    end

    Worker->>Worker: Log cleanup metrics
    Worker-->>Scheduler: Cleanup complete
```

---

## Monitoring & Observability

### Storage Metrics

```mermaid
graph TB
    subgraph "Key Metrics"
        M1[Bucket Size - Per Bucket]
        M2[Object Count - Per Bucket]
        M3[Upload Success Rate]
        M4[Upload Duration - P50/P95/P99]
        M5[Download Success Rate]
        M6[Download Duration - P50/P95/P99]
        M7[Cache Hit Rate]
        M8[Storage Costs - Monthly]
    end

    subgraph "Monitoring Tools"
        T1[Prometheus Metrics]
        T2[Grafana Dashboards]
        T3[MinIO Admin UI]
        T4[Application Logs]
    end

    M1 & M2 & M3 & M4 & M5 & M6 & M7 & M8 --> T1
    T1 --> T2
    T3 -.-> M1 & M2
    T4 -.-> M3 & M4 & M5 & M6

    classDef metric fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef tool fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class M1,M2,M3,M4,M5,M6,M7,M8 metric
    class T1,T2,T3,T4 tool
```

### Health Checks

```mermaid
graph LR
    A[Health Check Service] --> B{MinIO Reachable?}

    B -->|Yes| C{Buckets Exist?}
    B -->|No| D[Alert: MinIO Down]

    C -->|Yes| E{Upload Test Object}
    C -->|No| F[Alert: Buckets Missing]

    E -->|Success| G[Healthy]
    E -->|Failure| H[Alert: Upload Failure]

    G --> I[Delete Test Object]

    classDef healthy fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef unhealthy fill:#ffebee,stroke:#d32f2f,stroke-width:2px

    class A,B,C,E,G,I healthy
    class D,F,H unhealthy
```

---

## Summary

The storage system provides:

✅ **S3-Compatible Storage** via MinIO for cost-effective artifact management
✅ **Multi-Bucket Organization** for logical separation by artifact type
✅ **Secure Access Control** with RBAC and proxy layer
✅ **Presigned URL Support** for temporary, time-limited access
✅ **Automated Bucket Management** with initialization and retry logic
✅ **Performance Optimization** with caching and connection pooling
✅ **Lifecycle Management** with automated cleanup and retention
✅ **Network Isolation** - MinIO accessible only within Docker network
✅ **Comprehensive Monitoring** with metrics and health checks
