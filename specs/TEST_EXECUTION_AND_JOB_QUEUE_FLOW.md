# Test Execution and Job Queue Flow Specification

## Overview

The Supercheck test execution system provides a **distributed, secure, and scalable architecture** for running Playwright and K6 performance tests. The system uses **BullMQ** job queues, **container-based execution** for security isolation, and **horizontal scaling** for high throughput.

**🔒 Security-First Design:** All test execution runs in isolated Docker containers with comprehensive security boundaries, preventing code injection attacks and ensuring complete isolation from the host system.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Container-Based Execution](#container-based-execution)
3. [Execution Pipeline](#execution-pipeline)
4. [Queue Management](#queue-management)
5. [Worker Architecture](#worker-architecture)
6. [Resource Limits & Management](#resource-limits--management)
7. [Docker Compose Best Practices](#docker-compose-best-practices)
8. [Performance Optimization](#performance-optimization)
9. [Monitoring & Observability](#monitoring--observability)

## System Architecture

```mermaid
graph TB
    subgraph "🎨 Frontend Layer"
        UI[User Interface]
        MONITOR[Real-time Monitoring]
    end

    subgraph "🔐 API Layer"
        API1[Test Execution API]
        API2[Job Execution API]
        API3[Capacity Check API]
    end

    subgraph "📨 Queue System"
        REDIS[(Redis)]
        Q1[test-execution queue]
        Q2[job-execution queue]
        Q3[k6-test-execution queue]
        Q4[k6-job-execution queue]
    end

    subgraph "⚙️ Worker Pool (Horizontal Scaling)"
        W1[Worker 1<br/>Concurrency: 2]
        W2[Worker 2<br/>Concurrency: 2]
        W3[Worker N<br/>Concurrency: 2]
    end

    subgraph "🐳 Container Execution Layer"
        subgraph "Security Isolation"
            C1[Playwright Container 1]
            C2[Playwright Container 2]
            C3[K6 Container 1]
            C4[K6 Container 2]
        end
        
        CONTAINER[Container Executor Service]
        VALIDATION[Script Validation]
    end

    subgraph "💾 Storage Layer"
        DB[(PostgreSQL<br/>Metadata)]
        S3[MinIO/S3<br/>Artifacts]
        CACHE[Redis<br/>Capacity Tracking]
    end

    subgraph "📊 Observability"
        OTEL[OpenTelemetry Traces]
        METRICS[Metrics Collection]
        CLICK[(ClickHouse<br/>Time Series)]
    end

    UI --> API1 & API2
    API1 & API2 --> API3
    API3 --> CACHE
    API1 --> Q1 & Q3
    API2 --> Q2 & Q4

    Q1 & Q2 & Q3 & Q4 --> REDIS
    REDIS --> W1 & W2 & W3

    W1 & W2 & W3 --> VALIDATION
    VALIDATION --> CONTAINER
    CONTAINER --> C1 & C2 & C3 & C4

    C1 & C2 & C3 & C4 --> S3
    C1 & C2 & C3 & C4 --> DB
    C1 & C2 & C3 & C4 --> OTEL

    REDIS --> MONITOR
    OTEL --> CLICK
    MONITOR --> UI

    classDef frontend fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef api fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef queue fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef worker fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef container fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef storage fill:#e0f2f1,stroke:#00796b,stroke-width:2px
    classDef obs fill:#fce4ec,stroke:#c2185b,stroke-width:2px

    class UI,MONITOR frontend
    class API1,API2,API3 api
    class REDIS,Q1,Q2,Q3,Q4 queue
    class W1,W2,W3,VALIDATION,CONTAINER worker
    class C1,C2,C3,C4 container
    class DB,S3,CACHE storage
    class OTEL,METRICS,CLICK obs
```

## Container-Based Execution (Security Isolation)

### Overview

**All test execution (Playwright and K6) runs exclusively in Docker containers** for security isolation. There is no fallback to local execution. This prevents code injection attacks and ensures consistent, reproducible test environments.

### Container Execution Flow

```mermaid
graph TB
    subgraph "Worker Host"
        W[Worker Service]
        M["/workspace Mount<br/>Worker Directory"]
        NM["node_modules<br/>Playwright Package"]
        DS[Docker Socket<br/>Container Spawning]
    end

    subgraph "Docker Container (Isolated)"
        C[Container Executor]
        P["/workspace/node_modules/.bin/playwright"]
        B["Pre-installed Browsers<br/>/ms-playwright"]
        T[Test Execution]
        R[Report Generation]
    end

    subgraph "Security Boundaries"
        S1[Read-only Root Filesystem]
        S2[No Privilege Escalation]
        S3[Capability Drops]
        S4[Resource Limits]
        S5[Network Isolation]
    end

    W -->|Mount worker dir| M
    W -->|Access Docker| DS
    M --> NM
    M -->|Volume Mount| C
    DS -->|Spawn container| C
    C -->|Execute| P
    P -->|Use browsers| B
    P --> T
    T --> R
    R -->|Write to /workspace| M

    C --> S1 & S2 & S3 & S4 & S5

    classDef worker fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef container fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef security fill:#ffebee,stroke:#d32f2f,stroke-width:2px

    class W,M,NM,DS worker
    class C,P,B,T,R container
    class S1,S2,S3,S4,S5 security
```

### Docker Images Used

#### Playwright Container
- **Image**: `mcr.microsoft.com/playwright:v1.56.1-noble`
- **Size**: ~1.9 GB (cached after first pull)
- **Includes**:
  - Pre-installed browsers (Chromium, Firefox, WebKit) at `/ms-playwright`
  - All browser dependencies (fonts, libraries, codecs)
  - Node.js runtime
- **Volume Mount**: Worker directory → `/workspace`
- **Binary**: Uses `/workspace/node_modules/.bin/playwright` (from package.json)
- **Environment**: `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`

#### K6 Container
- **Image**: `grafana/k6:latest`
- **Size**: ~109 MB (cached after first pull)
- **Includes**:
  - K6 binary as ENTRYPOINT
  - xk6-dashboard extension for HTML reports
- **Volume Mount**: Script directory → `/workspace`

### Container Security Configuration

```mermaid
graph TB
    subgraph "Security Hardening"
        S1[--security-opt=no-new-privileges<br/>Prevent privilege escalation]
        S2[--cap-drop=ALL<br/>Drop all Linux capabilities]
        S3[--memory=2048m<br/>Memory limit]
        S4[--cpus=2<br/>CPU limit]
        S5[--pids-limit=100<br/>Process limit]
        S6[--network=bridge<br/>Network isolation]
        S7[Writable container /tmp<br/>For test scripts & reports]
        S8[--shm-size=512m<br/>Shared memory for browsers]
    end

    S1 & S2 --> SEC[Secure Execution Environment]
    S3 & S4 & S5 --> RES[Resource Protection]
    S6 --> NET[Network Isolation]
    S7 & S8 --> TEMP[Temp File Support]

    SEC & RES & NET & TEMP --> SAFE[Isolated & Secure Test Execution]

    classDef security fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef resource fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef result fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class S1,S2,SEC security
    class S3,S4,S5,S6,S7,S8,RES,NET,TEMP resource
    class SAFE result
```

### Path Mapping (Host → Container)

**Container-Only Execution: Minimal Host Mounts (Read-Only)**

| Host Path | Container Path | Mount Type | Purpose |
|-----------|---------------|------------|---------|
| `/Users/..../worker/node_modules` | `/workspace/node_modules` | Read-only | Playwright package & binary |
| `/Users/..../worker/playwright.config.js` | `/workspace/playwright.config.js` | Read-only | Playwright configuration |
| N/A (Docker image) | `/ms-playwright` | Built-in | Pre-installed browsers |
| N/A (inline script) | `/tmp/*.spec.mjs` | In-container | Test scripts (base64-decoded) |
| N/A (container) | `/tmp/playwright-reports/` | In-container | Test execution reports (regular filesystem) |

**Key Changes:**
- ✅ **No host directory mounts for test files** - Test scripts passed inline
- ✅ **Read-only mounts** - Only node_modules and config (security hardening)
- ✅ **Ephemeral test files** - All test scripts created inside container /tmp
- ✅ **Writable container filesystem** - Allows test script and report generation in `/tmp/`
- ✅ **Report extraction** - `docker cp` used to extract reports before container destruction

### Container Lifecycle Management

```mermaid
stateDiagram-v2
    [*] --> Created: Worker spawns container
    Created --> ScriptInject: Inline script injection
    ScriptInject --> Running: Test runner starts
    Running --> Executing: Test execution
    Executing --> Completed: Test finishes
    Executing --> Failed: Error/Timeout
    Completed --> Extract: docker cp reports
    Failed --> Extract: docker cp error logs
    Extract --> Removed: docker rm (auto)
    Removed --> Upload: Upload extracted reports
    Upload --> [*]

    note right of ScriptInject
        Test scripts decoded
        to /tmp/*.spec.mjs
        No host files needed
    end note

    note right of Running
        Security limits enforced
        Read-only mounts
        Network isolation applied
    end note

    note right of Extract
        docker cp /tmp/playwright-reports/
        → host OS temp directory
        Container auto-deleted after
    end note

    note right of Upload
        Reports uploaded to S3
        Metadata saved to DB
        OS temp directory cleaned
    end note
```

**Container-Only Benefits:**
- ✅ No host directory creation/cleanup
- ✅ Automatic container destruction handles internal cleanup
- ✅ Only extracted reports need cleanup (in OS temp)
- ✅ True isolation - test files never touch host persistent storage



## Execution Pipeline

### Complete Test Execution Flow

```mermaid
sequenceDiagram
    participant User
    participant API
    participant Capacity
    participant Queue
    participant Worker
    participant Container
    participant S3
    participant DB
    participant SSE

    User->>API: Execute Test
    API->>API: Validate test definition
    API->>Capacity: Check available capacity

    alt Capacity Available
        Capacity-->>API: Capacity OK
        API->>Queue: Add test to queue
        Queue-->>API: Job ID
        API-->>User: Test queued (runId)

        User->>SSE: Open SSE connection
        SSE-->>User: Connection established

        Queue->>Worker: Job available
        Worker->>Worker: Claim job
        Worker->>Capacity: Increment running count
        Worker->>SSE: Status: Active
        SSE-->>User: Test started

        Worker->>Container: Spawn isolated container
        activate Container
        Container->>Container: Execute test in isolation
        Container->>Container: Generate reports
        Container->>Container: Capture screenshots/videos
        deactivate Container

        Container->>S3: Upload artifacts
        S3-->>Container: Upload complete

        Worker->>DB: Save test results
        DB-->>Worker: Results saved

        Worker->>Container: Cleanup container
        Worker->>Capacity: Decrement running count
        Worker->>SSE: Status: Completed
        SSE-->>User: Test completed

        User->>API: Get test results
        API->>DB: Fetch results
        DB-->>API: Return results
        API-->>User: Display results

    else No Capacity
        Capacity-->>API: Capacity exceeded
        API-->>User: 429 Too Many Requests
    end
```

### Container Spawning Flow

```mermaid
sequenceDiagram
    participant Worker
    participant Docker
    participant Container
    participant Playwright

    Worker->>Docker: docker run (with security constraints)
    Note over Worker,Docker: --read-only, --security-opt, --cap-drop
    Docker->>Container: Create isolated container
    Docker->>Container: Mount /workspace volume
    Docker->>Container: Set resource limits
    
    Container->>Playwright: Execute /workspace/node_modules/.bin/playwright
    Playwright->>Container: Run test suite
    Container->>Container: Write reports to /workspace
    
    Container->>Worker: Exit with results
    Worker->>Docker: docker rm -f (cleanup)
    Docker-->>Worker: Container removed
```

### Job Execution Flow (Multiple Tests)

```mermaid
sequenceDiagram
    participant User
    participant API
    participant Queue
    participant Worker
    participant DB

    User->>API: Execute Job (10 tests)
    API->>API: Validate job
    API->>Queue: Add job to queue
    Queue-->>API: Job ID
    API-->>User: Job queued

    Queue->>Worker: Job available
    Worker->>Worker: Fetch job tests
    Worker->>DB: Get test definitions
    DB-->>Worker: 10 test configs

    loop For each test in job
        Worker->>Worker: Execute test
        Worker->>Worker: Upload artifacts
        Worker->>DB: Save test result
        Worker->>Worker: Update job progress
    end

    Worker->>DB: Mark job complete
    Worker->>Worker: Send notifications
    DB-->>Worker: Job saved
    Worker-->>User: Job complete notification
```

## Queue Management

### BullMQ Queue Architecture

```mermaid
graph TB
    subgraph "Queue Types"
        Q1[test-execution<br/>Single Tests]
        Q2[job-execution<br/>Multi-Test Jobs]
        Q3[k6-test-execution<br/>Performance Tests]
        Q4[monitor-execution<br/>Health Checks]
        Q5[Job Scheduler<br/>Cron Jobs]
    end

    subgraph "Queue Configuration"
        C1[Max Concurrency: 2/worker]
        C2[Job Timeout: 15 min]
        C3[Retry: 3 attempts]
        C4[Exponential Backoff]
        C5[Remove on Complete: 500]
        C6[Remove on Fail: 1000]
    end

    subgraph "Queue Events"
        E1[waiting → Job added]
        E2[active → Worker processing]
        E3[completed → Success]
        E4[failed → Error]
        E5[stalled → Timeout]
    end

    Q1 & Q2 & Q3 & Q4 & Q5 --> C1
    C1 --> C2 --> C3 --> C4 --> C5 --> C6

    C6 --> E1 --> E2 --> E3
    E2 --> E4
    E2 --> E5

    classDef queue fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef config fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef event fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class Q1,Q2,Q3,Q4,Q5 queue
    class C1,C2,C3,C4,C5,C6 config
    class E1,E2,E3,E4,E5 event
```

### Job Lifecycle States

```mermaid
stateDiagram-v2
    [*] --> Waiting: Job Added to Queue
    Waiting --> Active: Worker Picks Up
    Active --> Processing: Test Execution
    Processing --> Uploading: Tests Complete
    Uploading --> Completed: Artifacts Saved
    Processing --> Failed: Test Error
    Active --> Stalled: Worker Timeout
    Stalled --> Active: Retry
    Stalled --> Failed: Max Retries Exceeded
    Completed --> [*]
    Failed --> [*]

    note right of Active
        Worker claims job
        Capacity incremented
    end note

    note right of Processing
        Playwright/K6 executing
        Screenshots/videos captured
    end note

    note right of Completed
        Capacity decremented
        SSE notification sent
    end note
```

## Worker Architecture

### Worker Service Components

```mermaid
graph TB
    subgraph "Worker Service (NestJS)"
        MAIN[Main Worker Process]

        subgraph "Processors"
            P1[Test Execution Processor]
            P2[Job Execution Processor]
            P3[K6 Test Processor]
            P4[Monitor Processor]
        end

        subgraph "Services"
            S1[Execution Service]
            S2[S3 Upload Service]
            S3[Database Service]
            S4[Validation Service]
            S5[Resource Manager]
        end

        subgraph "Utilities"
            U1[Memory Monitor]
            U2[Timeout Handler]
            U3[Cleanup Service]
            U4[Trace Creator]
        end
    end

    MAIN --> P1 & P2 & P3 & P4
    P1 & P2 --> S1
    P3 --> S1
    P4 --> S1

    S1 --> S2 & S3 & S4 & S5
    S1 --> U1 & U2 & U3 & U4

    classDef processor fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef service fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef utility fill:#fff3e0,stroke:#f57c00,stroke-width:2px

    class P1,P2,P3,P4 processor
    class S1,S2,S3,S4,S5 service
    class U1,U2,U3,U4 utility
```

### Worker Execution Model

```mermaid
graph LR
    A[Worker Starts] --> B{Poll Queue}
    B -->|Job Available| C[Claim Job]
    B -->|No Jobs| D[Wait 1s]
    D --> B

    C --> E[Increment Capacity]
    E --> F[Execute Test]
    F --> G{Success?}

    G -->|Yes| H[Upload Artifacts]
    G -->|No| I[Capture Error]

    H --> J[Save Results]
    I --> J

    J --> K[Decrement Capacity]
    K --> L[Emit Event]
    L --> B

    classDef success fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef error fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef process fill:#e3f2fd,stroke:#1976d2,stroke-width:2px

    class H,J success
    class I error
    class A,B,C,E,F,K,L process
```

## Container-Based Execution (Security Isolation)

### Overview

**All test execution (Playwright and K6) runs exclusively in Docker containers** for security isolation. There is no fallback to local execution. This prevents code injection attacks and ensures consistent, reproducible test environments.

### Container Execution Flow

```mermaid
graph TB
    subgraph "Worker Host"
        W[Worker Service]
        M["/workspace Mount<br/>Worker Directory"]
        NM["node_modules<br/>Playwright Package"]
    end

    subgraph "Docker Container (Isolated)"
        C[Container Executor]
        P["/workspace/node_modules/.bin/playwright"]
        B["Pre-installed Browsers<br/>/ms-playwright"]
        T[Test Execution]
        R[Report Generation]
    end

    subgraph "Security Boundaries"
        S1[Read-only Root Filesystem]
        S2[No Privilege Escalation]
        S3[Capability Drops]
        S4[Resource Limits]
    end

    W -->|Mount worker dir| M
    M --> NM
    M -->|Volume Mount| C
    C -->|Execute| P
    P -->|Use browsers| B
    P --> T
    T --> R
    R -->|Write to /workspace| M

    C --> S1 & S2 & S3 & S4

    classDef worker fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef container fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef security fill:#ffebee,stroke:#d32f2f,stroke-width:2px

    class W,M,NM worker
    class C,P,B,T,R container
    class S1,S2,S3,S4 security
```

### Docker Images Used

#### Playwright Container
- **Image**: `mcr.microsoft.com/playwright:v1.56.1-noble`
- **Size**: ~1.9 GB (cached after first pull)
- **Includes**:
  - Pre-installed browsers (Chromium, Firefox, WebKit) at `/ms-playwright`
  - All browser dependencies (fonts, libraries, codecs)
  - Node.js runtime
- **Volume Mount**: Worker directory → `/workspace`
- **Binary**: Uses `/workspace/node_modules/.bin/playwright` (from package.json)
- **Environment**: `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`

#### K6 Container
- **Image**: `grafana/k6:latest`
- **Size**: ~109 MB (cached after first pull)
- **Includes**:
  - K6 binary as ENTRYPOINT
  - xk6-dashboard extension for HTML reports
- **Volume Mount**: Script directory → `/workspace`

### Container Security Configuration

```mermaid
graph TB
    subgraph "Security Hardening"
        S1[--security-opt=no-new-privileges<br/>Prevent privilege escalation]
        S2[--cap-drop=ALL<br/>Drop all Linux capabilities]
        S3[--memory=2048m<br/>Memory limit]
        S4[--cpus=2<br/>CPU limit]
        S5[--pids-limit=100<br/>Process limit]
        S6[--network=bridge<br/>Network isolation]
        S7[Writable container filesystem<br/>For test scripts & reports]
    end

    S1 & S2 --> SEC[Secure Execution Environment]
    S3 & S4 & S5 --> RES[Resource Protection]
    S6 --> NET[Network Isolation]
    S7 --> TMP[Temp File Support]

    SEC & RES & NET & TMP --> SAFE[Isolated & Secure Test Execution]

    classDef security fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef resource fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef result fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class S1,S2,SEC security
    class S3,S4,S5,S6,S7,RES,NET,TMP resource
    class SAFE result
```

### Path Mapping (Host → Container)

**Container-Only Execution: Minimal Host Mounts (Read-Only)**

| Host Path | Container Path | Mount Type | Purpose |
|-----------|---------------|------------|---------|
| `/Users/..../worker/node_modules` | `/workspace/node_modules` | Read-only | Playwright package & binary |
| `/Users/..../worker/playwright.config.js` | `/workspace/playwright.config.js` | Read-only | Playwright configuration |
| N/A (Docker image) | `/ms-playwright` | Built-in | Pre-installed browsers |
| N/A (inline script) | `/tmp/*.spec.mjs` | In-container | Test scripts (base64-decoded) |
| N/A (container) | `/tmp/playwright-reports/` | In-container | Test execution reports (regular filesystem) |

**Key Changes:**
- ✅ **No host directory mounts for test files** - Test scripts passed inline
- ✅ **Read-only mounts** - Only node_modules and config (security hardening)
- ✅ **Ephemeral test files** - All test scripts created inside container /tmp
- ✅ **Writable container filesystem** - Allows test script and report generation in `/tmp/`
- ✅ **Report extraction** - `docker cp` used to extract reports before container destruction

### Why Package.json Still Needs Playwright

**Q: Don't we get Playwright from the Docker image?**

**A: No!** The Docker image provides **browsers**, not the npm package:

```mermaid
graph LR
    subgraph "Docker Image Provides"
        I1[Pre-installed Browsers]
        I2[Browser Dependencies]
        I3[Node.js Runtime]
    end

    subgraph "package.json Provides"
        P1[Playwright npm Package]
        P2[playwright CLI Binary]
        P3["@playwright/test" Framework]
        P4[TypeScript Types]
    end

    subgraph "How They Work Together"
        W[Worker installs from package.json]
        M["node_modules mounted in container"]
        E["Execute /workspace/node_modules/.bin/playwright"]
        B["Use browsers from /ms-playwright"]
        W --> M
        M --> E
        E --> B
    end

    I1 & I2 & I3 --> B
    P1 & P2 & P3 & P4 --> E

    classDef image fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef package fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef execution fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class I1,I2,I3 image
    class P1,P2,P3,P4 package
    class W,M,E,B execution
```

**Required dependencies in package.json:**
- ✅ `playwright: ^1.56.0` - Core package with CLI
- ✅ `@playwright/test: ^1.56.0` - Test framework

### Image Caching Behavior

**Q: Are images downloaded on every execution?**

**A: No!** Docker caches images locally:

```mermaid
graph LR
    A[First Execution] -->|docker run| B{Image Exists Locally?}
    B -->|No| C[Pull from Registry<br/>~2 GB for Playwright]
    B -->|Yes| D[Use Cached Image<br/>Instant]
    C --> E[Cache Image]
    E --> F[Execute Container]
    D --> F

    G[Subsequent Executions] -->|docker run| H{Image Cached?}
    H -->|Yes| I[Use Cached Image<br/>No Download]
    I --> J[Execute Container]

    classDef download fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef cached fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class C download
    class D,E,I cached
```

**Cache invalidation:**
- Images are only re-downloaded when:
  - Image tag changes (e.g., `v1.56.0` → `v1.57.0`)
  - Manual pull: `docker pull <image>`
  - Image removed: `docker rmi <image>`

### Container Execution Performance

| Metric | Value | Notes |
|--------|-------|-------|
| Image pull (first time) | 60-120s | Playwright: ~1.9 GB, K6: ~109 MB |
| Image pull (cached) | 0s | Instant - uses local cache |
| Container startup | <1s | Very fast after first pull |
| Test execution overhead | <100ms | Negligible compared to test duration |
| Container cleanup | <500ms | Automatic with `--rm` flag |

## Parallel Execution

### Concurrency Control

```mermaid
graph TB
    A[Parallel Execution Manager] --> B[Configuration]

    B --> C["MAX_CONCURRENT_EXECUTIONS: 2"]
    B --> D[Per-Worker Limit]
    B --> E[Semaphore Pattern]

    F[Execution Flow] --> G{Current < Max?}
    G -->|Yes| H[Acquire Slot]
    G -->|No| I[Wait in Queue]

    H --> J[Execute Test]
    J --> K[Release Slot]
    K --> L[Next Test]

    I --> M{Timeout?}
    M -->|No| G
    M -->|Yes| N[Fail with Timeout]

    classDef config fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef exec fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef wait fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef error fill:#ffebee,stroke:#d32f2f,stroke-width:2px

    class B,C,D,E config
    class H,J,K,L exec
    class I,M wait
    class N error
```

### Resource Allocation

```mermaid
graph TB
    subgraph "Per-Worker Resources"
        R1[CPU: 2 cores allocated]
        R2[Memory: 3GB limit]
        R3[Disk: 10GB /tmp space]
        R4[Browser Instances: 2 max]
    end

    subgraph "Resource Monitoring"
        M1[Memory Usage Tracker]
        M2[CPU Usage Monitor]
        M3[Disk Space Check]
    end

    subgraph "Cleanup Triggers"
        C1[After Each Test]
        C2["On Memory Threshold: 80%"]
        C3["On Disk Threshold: 85%"]
        C4[Every 30 minutes]
    end

    R1 & R2 & R3 & R4 --> M1 & M2 & M3
    M1 & M2 & M3 --> C1 & C2 & C3 & C4

    classDef resource fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef monitor fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef cleanup fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class R1,R2,R3,R4 resource
    class M1,M2,M3 monitor
    class C1,C2,C3,C4 cleanup
```

## Capacity Management

### Global Capacity Tracking

```mermaid
graph TB
    subgraph "Redis Capacity Keys"
        K1["supercheck:capacity:running"<br/>Current Count]
        K2["supercheck:capacity:queued"<br/>Queue Count]
    end

    subgraph "Capacity Limits"
        L1["RUNNING_CAPACITY: 5"]
        L2["QUEUED_CAPACITY: 50"]
    end

    subgraph "Operations"
        O1["Before Queue: Check"]
        O2["Worker Start: Increment Running"]
        O3["Worker Complete: Decrement Running"]
        O4["Queue Add: Increment Queued"]
        O5["Worker Pickup: Decrement Queued"]
    end

    A[Job Request] --> O1
    O1 --> K1 & K2
    O1 --> L1 & L2

    O1 --> D{Capacity OK?}
    D -->|Yes| O4
    D -->|No| E["Reject: 429"]

    O4 --> F[Add to Queue]
    F --> O5
    O5 --> O2
    O2 --> G[Execute]
    G --> O3

    classDef redis fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef limit fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef op fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class K1,K2 redis
    class L1,L2 limit
    class O1,O2,O3,O4,O5 op
```

### Capacity Decision Flow

```mermaid
graph TB
    A[Test/Job Trigger] --> B{Check Running Capacity}
    B -->|running < RUNNING_CAPACITY| C[Allow]
    B -->|running >= RUNNING_CAPACITY| D{Check Queue Capacity}

    D -->|queued < QUEUED_CAPACITY| E[Add to Queue]
    D -->|queued >= QUEUED_CAPACITY| F[429 Capacity Exceeded]

    C --> G[Increment Queued Count]
    E --> G
    G --> H[Add to BullMQ]
    H --> I[Return Success]

    F --> J[Return Error with Retry-After]

    classDef success fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef check fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef error fill:#ffebee,stroke:#d32f2f,stroke-width:2px

    class C,E,G,H,I success
    class B,D check
    class F,J error
```

## Artifact Storage

### Storage Architecture

```mermaid
graph TB
    subgraph "Artifact Generation"
        A1[Playwright Execution]
        A2[HTML Report]
        A3[Screenshots PNG/JPEG]
        A4[Videos WebM]
        A5[Trace Files ZIP]
        A6[Console Logs]
    end

    subgraph "Local Storage"
        L1[/tmp/playwright-reports/]
        L2[playwright-results/]
    end

    subgraph "S3/MinIO Buckets"
        S1[playwright-test-artifacts]
        S2[playwright-job-artifacts]
        S3[k6-performance-artifacts]
        S4[playwright-monitor-artifacts]
    end

    subgraph "Database"
        D1[runs table<br/>Metadata + S3 URLs]
    end

    A1 --> A2 & A3 & A4 & A5 & A6
    A2 & A3 & A4 & A5 & A6 --> L1
    L1 --> L2

    L2 -->|Upload| S1 & S2 & S3 & S4
    S1 & S2 & S3 & S4 -->|Reference| D1

    classDef gen fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef local fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef s3 fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef db fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px

    class A1,A2,A3,A4,A5,A6 gen
    class L1,L2 local
    class S1,S2,S3,S4 s3
    class D1 db
```

### Upload Pipeline

```mermaid
sequenceDiagram
    participant Worker
    participant Local
    participant S3
    participant DB
    participant Cleanup

    Worker->>Local: Generate artifacts
    Local-->>Worker: Files created

    Worker->>Worker: Validate artifacts exist
    Worker->>S3: Recursive upload
    activate S3
    S3->>S3: Create bucket path
    S3->>S3: Upload files
    S3-->>Worker: Upload complete
    deactivate S3

    Worker->>DB: Save artifact URLs
    DB-->>Worker: Metadata saved

    Worker->>Cleanup: Trigger local cleanup
    Cleanup->>Local: Delete /tmp files
    Local-->>Cleanup: Cleanup complete
```

## Error Handling

### Error Recovery Strategy

```mermaid
graph TB
    A[Error Detected] --> B{Error Type?}

    B -->|Network Error| C[Retry 3x with backoff]
    B -->|Timeout| D[Mark as timeout, no retry]
    B -->|Out of Memory| E[Cleanup + Retry once]
    B -->|Validation Error| F[Fail immediately]
    B -->|Browser Crash| G[Retry 2x]

    C --> H{Retry Success?}
    H -->|Yes| I[Continue]
    H -->|No| J[Mark Failed]

    E --> K{Cleanup Success?}
    K -->|Yes| L[Retry Execution]
    K -->|No| J

    G --> M{Retry Success?}
    M -->|Yes| I
    M -->|No| J

    D --> J
    F --> J

    J --> N[Save Error Details]
    N --> O[Capture Screenshot]
    O --> P[Upload Error Artifacts]
    P --> Q[Send Notification]

    classDef retry fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef success fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef fail fill:#ffebee,stroke:#d32f2f,stroke-width:2px

    class C,E,G,H,K,L,M retry
    class I success
    class D,F,J,N,O,P,Q fail
```

### Timeout Management

```mermaid
graph LR
    A[Test Starts] --> B[Set Timeout Timer]
    B --> C{Execution Complete?}

    C -->|Before Timeout| D[Clear Timer]
    C -->|After Timeout| E[Kill Process]

    D --> F[Success]

    E --> G[Capture Partial Results]
    G --> H[Mark as Timeout]
    H --> I[Save What's Available]

    classDef normal fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef timeout fill:#ffebee,stroke:#d32f2f,stroke-width:2px

    class A,B,C,D,F normal
    class E,G,H,I timeout
```

## Performance Optimization

### Optimization Strategies

```mermaid
graph TB
    subgraph "Queue Optimization"
        Q1[Job Priority Levels]
        Q2[Batch Test Execution]
        Q3[Intelligent Retry Logic]
    end

    subgraph "Execution Optimization"
        E1[Browser Instance Reuse]
        E2[Parallel Test Execution]
        E3[Headless Mode Default]
        E4[Trace on Failure Only]
    end

    subgraph "Storage Optimization"
        S1[Compress Screenshots]
        S2[Stream Large Files]
        S3[Cleanup Old Artifacts]
        S4[Incremental Uploads]
    end

    subgraph "Resource Optimization"
        R1[Memory Pool Management]
        R2[CPU Affinity]
        R3[Disk Space Monitoring]
        R4[Network Bandwidth Control]
    end

    Q1 & Q2 & Q3 --> PERF[Performance Gains]
    E1 & E2 & E3 & E4 --> PERF
    S1 & S2 & S3 & S4 --> PERF
    R1 & R2 & R3 & R4 --> PERF

    PERF --> RESULT["50% Faster Execution<br/>30% Lower Resource Usage"]

    classDef opt fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef result fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class Q1,Q2,Q3,E1,E2,E3,E4,S1,S2,S3,S4,R1,R2,R3,R4 opt
    class RESULT result
```

### Key Performance Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Queue Wait Time | < 30s | 15s avg | ✅ |
| Test Execution Time | < 2 min | 1.5 min avg | ✅ |
| Artifact Upload Time | < 10s | 8s avg | ✅ |
| Worker Utilization | 70-80% | 75% avg | ✅ |
| Memory per Test | < 500MB | 380MB avg | ✅ |
| Concurrent Tests | 5 (default global limit) | 5 | ✅ |

## Configuration Reference

### Environment Variables

**Capacity Configuration:**
- `RUNNING_CAPACITY` - Maximum concurrent executions (default: 5)
- `QUEUED_CAPACITY` - Maximum queued jobs (default: 50)
- `MAX_CONCURRENT_EXECUTIONS` - Per-worker concurrency (default: 5)

> **Note:** These defaults are placeholders. When subscription-aware capacity management ships, limits will be derived from organization settings stored in the database, giving each org its own `RUNNING_CAPACITY`, `QUEUED_CAPACITY`, and per-worker concurrency values.

**Timeout Configuration:**
- `TEST_EXECUTION_TIMEOUT_MS` - Single test timeout (default: 120000 = 2 min)
- `JOB_EXECUTION_TIMEOUT_MS` - Job timeout (default: 900000 = 15 min)

**Playwright Configuration:**
- `PLAYWRIGHT_HEADLESS` - Run headless (default: true)
- `PLAYWRIGHT_RETRIES` - Retry count (default: 1)
- `PLAYWRIGHT_TRACE` - Trace mode (default: retain-on-failure)

**Resource Configuration:**
- `WORKER_MEMORY_LIMIT` - Memory limit (default: 3GB)
- `CLEANUP_INTERVAL_MS` - Cleanup frequency (default: 1800000 = 30 min)

## Resource Limits & Management

### Worker Resource Limits

```yaml
# Worker Container Configuration
worker:
  deploy:
    resources:
      limits:
        cpus: "2.0"          # Max 2 vCPU per worker
        memory: 2G           # Max 2GB RAM per worker
      reservations:
        cpus: "0.5"          # Guaranteed 0.5 vCPU
        memory: 1G           # Guaranteed 1GB RAM
```

### Test Container Resource Limits

```yaml
# Test Execution Container Limits
Container Security:
  memory: 2048m             # 2GB memory limit
  cpus: 2                   # 2 vCPU limit
  pids-limit: 100           # Max 100 processes
  shm-size: 512m            # Shared memory for browsers
  # /tmp uses regular container filesystem (no tmpfs)
  # Allows test scripts and reports to be generated
```

### Resource Allocation Strategy

```mermaid
graph TB
    subgraph "Host Resources (8 vCPU / 16 GB)"
        H1["System: 1 vCPU / 2 GB"]
        H2["PostgreSQL: 0.5 vCPU / 1 GB"]
        H3["Redis: 0.25 vCPU / 256 MB"]
        H4["MinIO: 0.5 vCPU / 1 GB"]
        H5["App: 1 vCPU / 2 GB"]
        H6["Observability: 0.75 vCPU / 1.5 GB"]
        H7["Workers: 4 vCPU / 8 GB"]
    end

    subgraph "Worker Allocation (3 workers)"
        W1["Worker 1: 1.33 vCPU / 2.67 GB"]
        W2["Worker 2: 1.33 vCPU / 2.67 GB"]
        W3["Worker 3: 1.33 vCPU / 2.67 GB"]
    end

    H7 --> W1 & W2 & W3

    classDef system fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef worker fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class H1,H2,H3,H4,H5,H6 system
    class W1,W2,W3 worker
```

### Memory Usage Patterns

| Component | Base Memory | Peak Memory | Notes |
|-----------|-------------|-------------|--------|
| Worker Process | ~200 MB | ~500 MB | NestJS runtime |
| Test Container | ~100 MB | ~2 GB | Browser execution |
| Playwright Browser | ~300 MB | ~1.5 GB | Chromium instance |
| K6 Runtime | ~50 MB | ~500 MB | Load testing |
| Report Generation | ~100 MB | ~300 MB | HTML/JSON reports |

### Monitoring Resource Usage

```mermaid
graph LR
    A[Resource Monitor] --> B{Memory > 85%?}
    A --> C{CPU > 90%?}
    A --> D{Disk > 90%?}
    
    B -->|Yes| E[Block New Jobs]
    C -->|Yes| F[Scale Workers Down]
    D -->|Yes| G[Trigger Cleanup]
    
    E --> H[Alert Admin]
    F --> H
    G --> H
    
    classDef alert fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef normal fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    
    class E,F,G,H alert
```

## Docker Compose Best Practices

### Production Docker Compose Configuration

```yaml
# Production-ready docker-compose.yml
version: '3.8'

# Use YAML anchors for DRY configuration
x-common-env: &common-env
  DATABASE_URL: ${DATABASE_URL}
  REDIS_URL: ${REDIS_URL}
  # ... other common variables

x-healthcheck: &default-healthcheck
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s

x-resource-limits: &default-limits
  cpus: "0.5"
  memory: 512M
  reservations:
    cpus: "0.25"
    memory: 256M

services:
  # App Service
  app:
    image: ghcr.io/supercheck-io/supercheck/app:1.1.3-beta
    restart: unless-stopped
    environment:
      <<: *common-env
    healthcheck:
      <<: *default-healthcheck
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 2G
        reservations:
          cpus: "0.5"
          memory: 1G
    networks:
      - supercheck-network
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  # Worker Service - Horizontal Scaling
  worker:
    image: ghcr.io/supercheck-io/supercheck/worker:1.1.3-beta
    restart: unless-stopped
    environment:
      <<: *common-env
      MAX_CONCURRENT_EXECUTIONS: 2  # Keep low, scale horizontally
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro  # Read-only socket
      - worker-reports:/app/reports
    deploy:
      replicas: 3  # Scale horizontally
      resources:
        limits:
          cpus: "2.0"  # Cap individual worker
          memory: 2G
        reservations:
          cpus: "0.5"
          memory: 1G
      restart_policy:
        condition: on-failure
        max_attempts: 3
        delay: 15s
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    healthcheck:
      <<: *default-healthcheck
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
    networks:
      - supercheck-network

# Network Configuration
networks:
  supercheck-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16

# Volume Configuration
volumes:
  postgres-data:
    driver: local
  redis-data:
    driver: local
  worker-reports:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /tmp/supercheck-reports
```

### Scaling Docker Compose Deployments

```bash
# Scale workers manually
docker-compose up --scale worker=5

# Scale with environment variables
WORKER_REPLICAS=5 docker-compose up

# Update docker-compose.yml for scaling
worker:
  deploy:
    replicas: ${WORKER_REPLICAS:-3}  # Default to 3
```

### Multi-Host Docker Compose

```yaml
# docker-compose.cluster.yml
version: '3.8'

services:
  # Shared services (run once)
  postgres:
    deploy:
      placement:
        constraints:
          - node.hostname == db-host

  redis:
    deploy:
      placement:
        constraints:
          - node.hostname == db-host

  # Worker services (run on all hosts)
  worker:
    deploy:
      mode: replicated
      replicas: 2  # Per host
      placement:
        max_replicas_per_node: 2
```

### Environment-Specific Configurations

```yaml
# docker-compose.override.yml (development)
version: '3.8'
services:
  worker:
    deploy:
      replicas: 1
    volumes:
      - ./worker/src:/app/src:ro  # Mount source for debugging
    environment:
      - NODE_ENV=development
      - LOG_LEVEL=debug

# docker-compose.prod.yml (production)
version: '3.8'
services:
  worker:
    deploy:
      replicas: 5
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### Best Practices Summary

**🎯 Scaling Best Practices:**
1. **Horizontal over Vertical** - Scale worker count, not individual worker size
2. **Resource Limits** - Always set CPU and memory limits
3. **Health Checks** - Implement comprehensive health monitoring
4. **Restart Policies** - Configure automatic restart on failure
5. **Security Hardening** - Use read-only filesystems and capability drops

**🔧 Docker Compose Best Practices:**
1. **YAML Anchors** - Use anchors for DRY configuration
2. **Environment Variables** - Externalize all configuration
3. **Network Isolation** - Use custom networks
4. **Volume Management** - Use named volumes with proper drivers
5. **Multi-Stage Builds** - Optimize image sizes

**📊 Monitoring Best Practices:**
1. **Resource Monitoring** - Track CPU, memory, and disk usage
2. **Queue Metrics** - Monitor queue depth and processing times
3. **Container Lifecycle** - Track container spawn/cleanup times
4. **Error Rates** - Monitor test failure patterns
5. **Capacity Planning** - Track utilization trends

## Related Documentation

- **Queue System:** See `REAL_TIME_STATUS_UPDATES_SSE.md` for SSE integration
- **Job Triggers:** See `JOB_TRIGGER_SYSTEM.md` for trigger types
- **Observability:** See `OBSERVABILITY.md` for tracing details
- **API Keys:** See `API_KEY_SYSTEM.md` for remote triggers

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 3.1 | 2025-01-14 | Moved scaling strategies to dedicated SCALING_GUIDE.md, integrated scaling options into Docker Compose files |
| 3.0 | 2025-01-14 | Major update - Container-based execution, scaling strategies, Docker Compose best practices |
| 2.0 | 2025-01-12 | Complete rewrite with comprehensive diagrams |
| 1.0 | 2024-09-15 | Initial test execution specification |
