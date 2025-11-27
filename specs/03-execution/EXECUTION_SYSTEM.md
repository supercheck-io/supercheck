# Execution System - Complete Architecture

## Overview

The Supercheck execution system provides a **distributed, secure, and scalable architecture** for running Playwright tests, K6 performance tests, and health monitoring checks. The system uses **BullMQ** job queues with **Redis**, **container-based execution** for security isolation, and **horizontal scaling** for high throughput.

**🔒 Security-First Design:** All test execution runs in isolated Docker containers with comprehensive security boundaries, preventing code injection attacks and ensuring complete isolation from the host system.

**📍 Multi-Location Support:** Tests and monitors can execute from multiple geographic locations for distributed load testing and global monitoring coverage.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [BullMQ Queue System](#bullmq-queue-system)
3. [Capacity Management](#capacity-management)
4. [Container Execution & Security](#container-execution--security)
5. [Test Execution Flow](#test-execution-flow)
6. [Job Execution Flow](#job-execution-flow)
7. [Multi-Location Execution](#multi-location-execution)
8. [Scheduler System](#scheduler-system)
9. [Worker Architecture](#worker-architecture)
10. [Resource Management](#resource-management)
11. [Docker Compose Best Practices](#docker-compose-best-practices)
12. [Error Handling & Retries](#error-handling--retries)
13. [Performance Optimization](#performance-optimization)
14. [Monitoring & Observability](#monitoring--observability)

---

## System Architecture

### Complete System Overview

```mermaid
graph TB
    subgraph "🎨 Frontend Layer"
        UI[User Interface]
        MONITOR[Real-time Monitoring<br/>Server-Sent Events]
    end

    subgraph "🔐 API Layer"
        API1[Test Execution API<br/>POST /api/test/route]
        API2["Job Execution API<br/>POST /api/jobs/{id}/trigger"]
        API3[Capacity Check API<br/>fetchQueueStats]
    end

    subgraph "📨 Queue System - Redis & BullMQ"
        REDIS[(Redis)]
        Q1["playwright-global queue"]
        Q2["k6-{region} queues"]
        Q3["monitor-{region} queues"]
        Q4[Scheduler Queues]
    end

    subgraph "⚙️ Worker Pool - Horizontal Scaling"
        W1[Worker Playwright Global]
        W2[Worker K6 Regional]
        W3[Worker Monitor Regional]
    end

    subgraph "🐳 Container Execution Layer"
        subgraph "Security Isolation"
            C1[Playwright Container]
            C2[K6 Container]
        end

        CONTAINER[Container Executor Service]
        VALIDATION[Script Validation]
    end

    subgraph "💾 Storage Layer"
        DB[(PostgreSQL<br/>Metadata)]
        S3[MinIO/S3<br/>Artifacts]
        CACHE[Redis<br/>Capacity Tracking]
    end

    UI --> API1 & API2
    API1 & API2 --> API3
    API3 --> CACHE
    API1 --> Q1
    API2 --> Q1 & Q2

    Q1 & Q2 & Q3 & Q4 --> REDIS
    REDIS --> W1 & W2 & W3

    W1 & W2 & W3 --> VALIDATION
    VALIDATION --> CONTAINER
    CONTAINER --> C1 & C2

    C1 & C2 --> S3
    C1 & C2 --> DB

    REDIS --> MONITOR
    MONITOR --> UI

    classDef frontend fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef api fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef queue fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef worker fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef container fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef storage fill:#e0f2f1,stroke:#00796b,stroke-width:2px

    class UI,MONITOR frontend
    class API1,API2,API3 api
    class REDIS,Q1,Q2,Q3,Q4 queue
    class W1,W2,W3,VALIDATION,CONTAINER worker
    class C1,C2 container
    class DB,S3,CACHE storage
```

### Data Flow Architecture

```mermaid
sequenceDiagram
    participant Client as Client/API
    participant API as API Layer
    participant Redis as Redis/BullMQ
    participant Worker as Worker Service
    participant Container as Container Executor
    participant S3 as S3 Storage
    participant DB as Database

    Client->>API: POST /api/test/route
    API->>Redis: Check capacity
    Redis-->>API: Capacity OK
    API->>API: Resolve variables & secrets
    API->>Redis: Add job to playwright-global queue
    Redis-->>API: Return job ID (202)
    API-->>Client: Job ID & status

    Redis->>Worker: Job available
    Worker->>Worker: Validate test data
    Worker->>Container: Execute test in container
    Container->>Container: Run test script
    Container->>Container: Collect traces & screenshots
    Container->>S3: Upload artifacts
    S3-->>Container: Artifact paths
    Container->>Worker: Execution result

    Worker->>DB: Save test result
    Worker->>S3: Upload report
    Worker->>Redis: Emit completion event
    Redis-->>Client: test:completed event
```

---

## BullMQ Queue System

### Queue Definitions

The system manages distinct queues for different execution types and regions:
### Worker Architecture

**Production:** 3 location-based workers, each handling multiple queue types:

| Worker | Location | Regional Queues | Global Queues |
|--------|----------|----------------|---------------|
| `supercheck-worker-us` | us-east | `k6-us-east`, `monitor-us-east` | `playwright-global`, `k6-global` |
| `supercheck-worker-eu` | eu-central | `k6-eu-central`, `monitor-eu-central` | `playwright-global`, `k6-global` |
| `supercheck-worker-apac` | asia-pacific | `k6-asia-pacific`, `monitor-asia-pacific` | `playwright-global`, `k6-global` |

**Architecture Benefits:**
- ✅ **Resource efficiency**: Each worker handles multiple job types
- ✅ **Automatic load balancing**: Global queues processed by any available worker
- ✅ **Geographic accuracy**: Regional queues ensure correct execution location
- ✅ **Simple scaling**: Scale by region (3 deployments vs 8)

**Local Development:** Set `WORKER_REGION=local` to process all queues on a single worker. Configured automatically in Docker Compose.

### Active Queues (14 Total)


**Playwright Execution (Global):**
- **playwright-global** - Handles all Playwright tests and jobs (consolidated)

**K6 Execution (Regional):**
- **k6-us-east** - K6 load tests from US East region
- **k6-eu-central** - K6 load tests from EU Central region
- **k6-asia-pacific** - K6 load tests from Asia Pacific region
- **k6-global** - K6 load tests from Global region

**Monitor Execution (Regional):**
- **monitor-us-east** - Synthetic monitors from US East region
- **monitor-eu-central** - Synthetic monitors from EU Central region (default)
- **monitor-asia-pacific** - Synthetic monitors from Asia Pacific region

**Scheduler Queues (3):**
- **job-scheduler** - Triggers scheduled jobs hourly
- **k6-job-scheduler** - Triggers scheduled K6 jobs hourly
- **monitor-scheduler** - Triggers scheduled monitors every 5 minutes

**Utility Queues (2):**
- **email-template-render** - Email template rendering
- **data-lifecycle-cleanup** - Database and artifact cleanup

### Queue Architecture

```mermaid
graph TB
    subgraph "Queue Types"
        Q1[playwright-global<br/>All Playwright Tasks]
        Q2["k6-{region}<br/>Regional Load Tests"]
        Q3["monitor-{region}<br/>Regional Monitors"]
        Q4[Scheduler Queues<br/>Cron Jobs]
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

    Q1 & Q2 & Q3 & Q4 & Q5 & Q6 --> C1
    C1 --> C2 --> C3 --> C4 --> C5 --> C6

    C6 --> E1 --> E2 --> E3
    E2 --> E4
    E2 --> E5

    classDef queue fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef config fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef event fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class Q1,Q2,Q3,Q4,Q5,Q6 queue
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

### Queue Configuration

Each queue is configured with memory-optimized settings:

**Job Retention:**
- Completed jobs: 500 maximum, kept for 24 hours
- Failed jobs: 1000 maximum, kept for 7 days
- Automatic removal based on age and count

**Retry Strategy:**
- Attempts: 3 retries for execution jobs, 2 for job execution
- Backoff: Exponential with 1-second initial delay
- Stalled job detection: Every 30 seconds

**Metrics:**
- Maximum 60 data points per queue (1 hour at 1-minute intervals)
- Prevents unbounded Redis memory growth

---

## Capacity Management

### Overview

Capacity is managed through **Redis-based atomic counters** with **organization-specific limits**. The system uses Lua scripts to prevent race conditions and enforce plan-based capacity constraints.

### Capacity Limits by Plan

| Plan | Running Capacity | Queued Capacity | Use Case |
|------|------------------|-----------------|----------|
| Plus | 5 concurrent | 50 queued | Small teams |
| Pro | 10 concurrent | 100 queued | Growing teams |
| Unlimited (Self-hosted) | 999 concurrent | 9999 queued | Self-hosted deployments |

**Environment Variable Overrides (Self-hosted only):**
```bash
RUNNING_CAPACITY=10    # Override plan-specific running limit
QUEUED_CAPACITY=100    # Override plan-specific queued limit
```

### Atomic Capacity Enforcement

**✅ Race Condition Prevention**
- Uses Redis Lua scripts for atomic capacity check + slot reservation
- Eliminates race conditions between concurrent requests
- Per-organization key isolation: `capacity:running:{orgId}`, `capacity:queued:{orgId}`

**✅ Counter Leak Prevention**
- 24-hour TTL on all Redis counters
- Job lifecycle events properly release counters:
  - `active`: transitions queued→running
  - `completed/failed`: releases running slots
  - `failed` (before active): releases queued slots
  - `stalled`: releases running slots with warnings

### Atomic Capacity Check Flow

```mermaid
sequenceDiagram
    participant API as API Layer
    participant CM as Capacity Manager
    participant Redis as Redis (Lua Script)
    participant Queue as Queue

    API->>CM: reserveSlot(organizationId)
    CM->>CM: checkCapacityLimits(organizationId)
    CM->>Redis: Execute Lua Script (Atomic)
    Redis->>Redis: Check queued < queuedCapacity?
    Redis->>Redis: Check running < runningCapacity?
    Redis->>Redis: INCR queued counter
    Redis-->>CM: Return slotReserved (boolean)

    alt slotReserved = false
        CM-->>API: Throw Error (429 - Capacity Limit Reached)
    else slotReserved = true
        API->>Redis: Resolve variables & secrets
        API->>Queue: Add job to appropriate queue
        Queue-->>API: Return job ID (202 Accepted)
        
        Note over Queue: Job Events Handle Counter Management:
        Queue->>CM: active event → transitionQueuedToRunning()
        Queue->>CM: completed event → releaseRunningSlot()
        Queue->>CM: failed event → releaseRunningSlot() or releaseQueuedSlot()
    end
```

### Organization-Specific Capacity Tracking

```mermaid
graph TB
    subgraph "Redis Atomic Counters"
        K1["capacity:running:{orgId}"<br/>Running Jobs Count]
        K2["capacity:queued:{orgId}"<br/>Queued Jobs Count]
        K3["TTL: 24 hours<br/>Prevents leaks"]
    end

    subgraph "Plan-Based Limits"
        L1["Plus: 5 running, 50 queued"]
        L2["Pro: 10 running, 100 queued"]
        L3["Unlimited: 999 running, 9999 queued"]
    end

    subgraph "Atomic Operations"
        O1["reserveSlot(): Lua Script<br/>Check + Increment"]
        O2["transitionQueuedToRunning()<br/>DECR queued, INCR running"]
        O3["releaseRunningSlot()<br/>DECR running"]
        O4["releaseQueuedSlot()<br/>DECR queued"]
    end

    subgraph "Job Events"
        E1["active → O2"]
        E2["completed → O3"]
        E3["failed → O3 or O4"]
        E4["stalled → O3"]
    end

    A[Job Request] --> O1
    O1 --> K1 & K2
    O1 --> L1 & L2 & L3

    O1 --> D{Slot Reserved?}
    D -->|Yes| F[Add to Queue]
    D -->|No| R["429 Error"]

    F --> E1
    E1 --> O2
    E2 & E3 & E4 --> O3 & O4

    classDef redis fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef limit fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef op fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef event fill:#e3f2fd,stroke:#1976d2,stroke-width:2px

    class K1,K2,K3 redis
    class L1,L2,L3 limit
    class O1,O2,O3,O4 op
    class E1,E2,E3,E4 event
```

### Queue Statistics

Queue statistics track:
- Currently active jobs (running count)
- Max allowed running jobs (capacity)
- Jobs waiting to run (queued count)
- Max allowed queued jobs (capacity)

Execution queues counted in statistics:
- playwright-global
- k6-{region} (us-east, eu-central, asia-pacific, global)

**Monitor Execution Bypass:**
- ✅ **Critical monitors bypass capacity limits entirely**
- ✅ Monitor queues are excluded from capacity calculations
- ✅ Dedicated regional queues: `monitor-{region}` 
- ✅ Ensures uninterrupted health monitoring regardless of test capacity

---

## Container Execution & Security

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

    subgraph "Docker Container - Isolated"
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

**Both Playwright & K6 - Unified Worker Image:**
- Image: `ghcr.io/supercheck-io/supercheck/worker:latest`
- Size: ~3.26 GB (cached after first pull)
- **Includes Both:**
  - **Playwright**: Pre-installed browsers (Chromium, Firefox, WebKit) at `/ms-playwright`
  - **K6**: Custom binary with xk6-dashboard extension at `/usr/local/bin/k6`
  - Node.js 20 runtime
  - All browser dependencies (fonts, libraries, codecs)
- **Why Unified Image:**
  - ✅ Single image for both test types (consistency)
  - ✅ Pre-installed browsers & k6 (no runtime installations)
  - ✅ No network dependency during execution (faster, more secure)
  - ✅ Guaranteed version consistency across all environments
  - ✅ Simplified deployment (one image to manage)
- Volume Mount: Worker node_modules → `/workspace/node_modules` (read-only)
- Environment: `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`
- **Test Execution Mode:** Inline scripts injected, no host filesystem dependency

### Container Security Configuration

```mermaid
graph TB
    subgraph "Security Hardening"
        S1[--security-opt=no-new-privileges<br/>Prevent privilege escalation]
        S2[--cap-drop=ALL<br/>Drop all Linux capabilities]
        S3["--memory=2048m<br/>Memory limit (Configurable)"]
        S4["--cpus=1.5<br/>CPU limit (Configurable)"]
        S5["--pids-limit=100<br/>Process limit"]
        S6["--network=bridge<br/>Network isolation"]
        S7["Writable container /tmp<br/>For test scripts & reports"]
        S8["--shm-size=512m<br/>Shared memory for browsers"]
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

### Container Cleanup & Lifecycle

```mermaid
graph TB
    A["Container Created"]
    B["Isolated Filesystem"]
    C["Resource Limits Applied"]
    D["Environment Variables Injected"]
    E["Test Execution"]
    F["Script Runs Inside Container"]
    G["Traces Written to /tmp/trace-*"]
    H["Screenshots Written to /tmp/screenshots-*"]
    I["Logs Captured"]
    J["Artifact Collection"]
    K["Copy Traces from Container"]
    L["Copy Screenshots from Container"]
    M["Copy Logs from Container"]
    N["Upload to S3"]
    O["Container Cleanup"]
    P["Container Stopped"]
    Q["Container Removed"]
    R["All Temporary Files Destroyed"]
    S["No Host-Side Cleanup Needed"]

    A --> B & C & D
    B & C & D --> E
    E --> F & G & H & I
    F & G & H & I --> J
    J --> K & L & M
    K & L & M --> N
    N --> O
    O --> P & Q & R & S

    classDef execution fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef artifact fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef cleanup fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class A,B,C,D,E,F execution
    class G,H,I,J,K,L,M,N artifact
    class O,P,Q,R,S cleanup
```

### Why No Local Cleanup is Needed

**Execution happens inside container:**
- Temporary files created inside container's isolated filesystem
- Container has its own /tmp directory
- No files written to host machine

**Container cleanup is automatic:**
- When container execution completes, container is destroyed
- All temporary files destroyed with container
- No scheduled cleanup operations needed

**Host machine remains clean:**
- No local `playwright-reports/` folders accumulate
- No local `k6-reports/` folders accumulate
- No temporary test files on host
- Container filesystem is completely isolated

---

## Test Execution Flow

### Complete Test Execution Sequence

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

### Process Steps

**1. Job Submission (API Layer)**
- Receive test execution request with test data
- Check current capacity via fetchQueueStats()
- Validate running count < RUNNING_CAPACITY
- Validate queued count < QUEUED_CAPACITY
- Resolve variables and secrets
- Add job to test-execution queue with priority and retention settings
- Return job ID and status 202 (Accepted)

**2. Worker Processing**
- Worker picks up job from test-execution queue
- Validate job data structure and required fields
- Route to appropriate executor (Playwright, K6, Monitor)
- Execute in container environment
- Process and return results

**3. Container Execution**
- Create isolated container context with unique ID
- Prepare test script with trace configuration
- Execute inside container with resource limits
- Collect artifacts (traces, screenshots, logs)
- Upload artifacts to S3
- Container cleanup is automatic - no local folders remain

**4. Result Handling**
- Save results to database
- Upload reports to S3
- Emit completion event
- Update run status if applicable
- Clean up execution tracking

---

## Job Execution Flow

### Sequential Multi-Test Execution

```mermaid
sequenceDiagram
    participant Client as Client/API
    participant API as API Layer
    participant DB as Database
    participant Redis as Redis/BullMQ
    participant Worker as Worker Service
    participant Container as Container Executor
    participant S3 as S3 Storage

    Client->>API: POST /api/jobs/[id]/trigger
    API->>DB: Fetch job configuration
    DB-->>API: Job config
    API->>Redis: Check capacity
    Redis-->>API: Capacity OK
    API->>DB: Create run record
    DB-->>API: Run ID
    API->>API: Resolve variables & secrets
    API->>Redis: Add to job-execution queue
    Redis-->>API: Queue job ID
    API-->>Client: Run ID & status

    Redis->>Worker: Job available
    Worker->>DB: Update run status to "running"

    loop For each test in job
        Worker->>Container: Execute test in container
        Container->>Container: Run test script
        Container->>S3: Upload artifacts
        S3-->>Container: Artifact paths
        Container-->>Worker: Test result
        Worker->>DB: Save individual test result
    end

    Worker->>Worker: Aggregate results
    Worker->>DB: Update run status
    Worker->>Worker: Generate report
    Worker->>S3: Upload report
    Worker->>DB: Update run with report path & completion time
    Worker-->>Client: Job completion event
```

### Process Steps

**1. Job Submission**
- Fetch job configuration from database
- Check capacity limits
- Create run record
- Resolve variables and secrets
- Add to job-execution queue with retention settings
- Return run ID and queue job ID

**2. Sequential Test Execution**
- Update run status to "running"
- Execute tests sequentially (one at a time)
- For each test:
  - Execute in container
  - Save individual test result
  - Continue on error
- Aggregate all results
- Update run status based on aggregated results
- Generate report
- Upload report to S3
- Update run with report path and completion time

---

## Multi-Location Execution

### Playwright Execution (Global)

Playwright tests and jobs are executed via a **single global queue** (`playwright-global`). This simplifies the architecture as browser-based tests are typically less sensitive to geographic latency for functional verification compared to load tests.

### K6 Multi-Location Execution

K6 load tests can be executed from multiple geographic locations for distributed load testing:

**Location Configuration:**
- US East (Primary)
- US West
- Europe
- Asia Pacific
- Global (Default)

**Execution Strategy:**
- Each location runs the same K6 script independently
- Results are aggregated by execution group ID
- Distributed load from multiple geographic points
- Better simulation of global user behavior

**Queue Flow for Multi-Location K6:**

```mermaid
graph TB
    A["K6 Job Submission<br/>with locations: US_EAST, EU, APAC"]
    B["Create Execution Group ID<br/>k6-job-{timestamp}-{random}"]
    C["For each location"]
    D["Add to k6-job-execution queue<br/>with location parameter"]
    E["Worker picks up job<br/>for specific location"]
    F["Execute K6 script<br/>from location"]
    G["Collect metrics<br/>from location"]
    H["Aggregate results<br/>by execution group"]

    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    G --> H

    classDef process fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef execution fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef aggregation fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class A,B,C,D process
    class E,F,G execution
    class H aggregation
```

### Monitor Multi-Location Execution

Health checks and monitors can run from multiple locations for global coverage:

**Location Configuration:**
- US East (Default)
- US West
- Europe
- Asia Pacific
- Additional custom locations

**Execution Modes:**

**Single Location Mode (Default):**
- Monitor runs from US East only
- Fastest execution
- Lower resource usage

**Multi-Location Mode:**
- Monitor runs from all configured locations simultaneously
- Execution group ID tracks related jobs
- Results aggregated by location
- Threshold strategy determines overall status

**Threshold Strategies:**
- **Majority** - More than 50% of locations must be up
- **All** - All locations must be up
- **Any** - At least one location must be up

**Queue Flow for Multi-Location Monitors:**

```mermaid
graph TB
    A["Monitor Execution Request<br/>locations: US_EAST, EU, APAC<br/>strategy: majority"]
    C["Create Execution Group ID<br/>monitor-{monitorId}-{timestamp}-{random}"]
    D["For each location"]
    E["Add to monitor-execution queue<br/>with location & group ID"]
    F["Worker picks up job<br/>for specific location"]
    G["Execute health check<br/>from location"]
    H["Save result with location"]
    I["Aggregate results<br/>by execution group"]
    J["Apply threshold strategy<br/>majority/all/any"]
    K["Determine overall status"]

    A --> C
    C --> D
    D --> E
    E --> F
    F --> G
    G --> H
    H --> I
    I --> J
    J --> K

    classDef config fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef execution fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef aggregation fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class A,B,C,D,E config
    class F,G,H execution
    class I,J,K aggregation
```

### Location Service

The location service manages location configurations:

**Available Monitoring Locations:**
- US_EAST: United States (East Coast)
- US_WEST: United States (West Coast)
- EU: Europe
- APAC: Asia Pacific

**Default Configuration:**
- Enabled: false (single location mode)
- Primary location: US_EAST
- Threshold: 50% (majority strategy)
- Strategy: Majority

**Effective Locations Logic:**
- If multi-location disabled: Use default primary location (US_EAST)
- If multi-location enabled: Use configured locations
- Fallback: Default to US_EAST if no locations specified

---

## Scheduler System

### Job Scheduler

**Execution Schedule:** Every hour (0 * * * *)

**Process:**

```mermaid
sequenceDiagram
    participant Scheduler
    participant DB
    participant Queue

    Scheduler->>DB: Query scheduled jobs
    DB-->>Scheduler: Jobs with schedule enabled
    Scheduler->>Scheduler: Filter jobs due for execution

    loop For each job to schedule
        Scheduler->>DB: Create run record
        Scheduler->>Queue: Add to job-execution queue
        Scheduler->>DB: Update next execution time
    end

    Scheduler-->>Scheduler: Continue asynchronously
```

**Scheduler Steps:**
1. Scheduler checks database for scheduled jobs
   - Query jobs with schedule enabled
   - Check if next execution time has passed
   - Filter by organization/project access
2. For each job to schedule:
   - Create run record
   - Add to job-execution queue
   - Update next execution time
3. Scheduler runs asynchronously
   - Non-blocking operation
   - Continues even if individual jobs fail

### Monitor Scheduler

**Execution Schedule:** Every 5 minutes (*/5 * * * *)

**Process:**

```mermaid
sequenceDiagram
    participant Scheduler
    participant DB
    participant Queue

    Scheduler->>DB: Query active monitors
    DB-->>Scheduler: Enabled monitors
    Scheduler->>Scheduler: Filter monitors due for check

    loop For each monitor to check
        Scheduler->>Scheduler: Determine location(s)

        alt Multi-location enabled
            Scheduler->>Queue: Create jobs for all locations
        else Single location
            Scheduler->>Queue: Create single job
        end

        Scheduler->>DB: Update next check time
    end

    Scheduler-->>Scheduler: Continue asynchronously
```

**Scheduler Steps:**
1. Scheduler checks database for active monitors
   - Query monitors with enabled status
   - Check if next check time has passed
   - Determine execution location(s)
2. For each monitor to check:
   - Add to monitor-execution queue
   - Include location configuration
   - Update next check time
3. Multi-location support:
   - If multi-location enabled: Create jobs for each location
   - If single location: Create single job
   - Execution group ID tracks related jobs

---

## Worker Architecture

### Worker Service Components

```mermaid
graph TB
    subgraph "Worker Service - NestJS"
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

---

## Resource Management

### Worker Resource Limits

**Worker Container Configuration:**
- CPU Limits: 2.0 vCPU max per worker
- Memory Limits: 2GB max per worker
- CPU Reservations: 0.5 vCPU guaranteed
- Memory Reservations: 1GB guaranteed

### Test Container Resource Limits

**Container Security Configuration:**
- Memory: 2048m (2GB limit)
- CPUs: 2 (2 vCPU limit)
- PIDs Limit: 100 (max 100 processes)
- Shared Memory: 512m (for browsers)
- Temporary Files: Uses regular container filesystem

### Resource Allocation Strategy

```mermaid
graph TB
    subgraph "Host Resources - 8 vCPU / 16 GB"
        H1["System: 1 vCPU / 2 GB"]
        H2["PostgreSQL: 0.5 vCPU / 1 GB"]
        H3["Redis: 0.25 vCPU / 256 MB"]
        H4["MinIO: 0.5 vCPU / 1 GB"]
        H5["App: 1 vCPU / 2 GB"]
        H6["Observability: 0.75 vCPU / 1.5 GB"]
        H7["Workers: 4 vCPU / 8 GB"]
    end

    subgraph "Worker Allocation - 3 workers"
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

---

## Docker Compose Best Practices

### Production Configuration Example

**Key Best Practices:**

1. **YAML Anchors for DRY Configuration**
   - Common environment variables
   - Default health checks
   - Resource limits

2. **Health Checks**
   - Interval: 30 seconds
   - Timeout: 10 seconds
   - Retries: 3
   - Start period: 60 seconds

3. **Resource Limits**
   - CPU limits and reservations
   - Memory limits and reservations
   - Prevents resource exhaustion

4. **Security Hardening**
   - Read-only Docker socket
   - no-new-privileges security option
   - Capability drops (ALL)

5. **Horizontal Scaling**
   - Worker replicas: 3 (configurable)
   - Low per-worker concurrency (2)
   - Scale by adding workers, not increasing concurrency

### Scaling Docker Compose Deployments

> **Note:** For Kubernetes deployments, we use **KEDA** for event-driven autoscaling based on BullMQ queue depth. See [SCALING_GUIDE.md](../08-operations/SCALING_GUIDE.md#kubernetes-autoscaling-keda) for details.

**Horizontal Scaling Strategy:**

```mermaid
graph TB
    A[Scaling Decision] --> B{Current Load}

    B -->|Low| C[1-2 Workers<br/>Concurrency: 2]
    B -->|Medium| D[3-5 Workers<br/>Concurrency: 2]
    B -->|High| E[6-10 Workers<br/>Concurrency: 2]
    B -->|Very High| F[10+ Workers<br/>Concurrency: 2]

    C & D & E & F --> G[Monitor Performance]
    G --> H{Optimal?}
    H -->|No| A
    H -->|Yes| I[Maintain Configuration]

    classDef low fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef medium fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef high fill:#ffebee,stroke:#d32f2f,stroke-width:2px

    class C low
    class D,E medium
    class F high
```

**Best Practices Summary:**

**🎯 Scaling Best Practices:**
1. Horizontal over Vertical - Scale worker count, not individual worker size
2. Resource Limits - Always set CPU and memory limits
3. Health Checks - Implement comprehensive health monitoring
4. Restart Policies - Configure automatic restart on failure
5. Security Hardening - Use read-only filesystems and capability drops

**🔧 Docker Compose Best Practices:**
1. YAML Anchors - Use anchors for DRY configuration
2. Environment Variables - Externalize all configuration
3. Network Isolation - Use custom networks
4. Volume Management - Use named volumes with proper drivers
5. Multi-Stage Builds - Optimize image sizes

---

## Error Handling & Retries

### Retry Strategy

**Default job options for all execution queues:**
- Attempts: 3 retries for execution jobs, 2 for job execution
- Backoff type: Exponential
- Initial delay: 1 second
- Keep completed jobs: 500 max, 24 hours
- Keep failed jobs: 1000 max, 7 days

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

### Failure Scenarios

| Scenario | Handling | Reason |
|----------|----------|--------|
| Container timeout | Extract reports, fail job, don't retry | Partial reports preserve execution history for debugging |
| Network error | Retry with exponential backoff | Transient error, likely to succeed on retry |
| Database error | Retry with exponential backoff | Transient error, database may recover |
| Invalid script | Fail immediately, don't retry | Code error, retries won't help |

### Timeout Handling & Report Extraction

**Critical Improvement (v1.1.7+):**
- **Before**: Container removed immediately on timeout → reports lost
- **After**: Reports extracted even on timeout → debugging enabled

**Execution Flow on Timeout:**
```
Timeout detected
    ↓
Container kept alive (NOT removed)
    ↓
Extract reports from container
    ↓
Container cleaned up
    ↓
Partial reports available for analysis
```

**Benefits:**
- ✅ **Debugging**: See what test accomplished before timeout
- ✅ **History**: Report shows progress, failures, screenshots
- ✅ **Investigation**: Identify slow operations, flaky tests
- ✅ **Proper Cleanup**: Container always removed after extraction

**Timeout Configuration:**
- `TEST_EXECUTION_TIMEOUT_MS=300000` (5 minutes per test)
- `JOB_EXECUTION_TIMEOUT_MS=900000` (15 minutes per job)
- `K6_TEST_EXECUTION_TIMEOUT_MS=3600000` (60 minutes for k6)

| Out of memory | Fail job, don't retry | Resource issue, needs manual intervention |
| Location unavailable | Fail for that location, continue others | Multi-location: other locations may succeed |

---

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

### Capacity Tuning

**Container Resource Allocation (per execution container):**

| Type | Memory | CPUs | Notes |
|------|--------|------|-------|
| **Playwright** | 4GB | 4.0 | Supports 2 parallel workers with stable execution |
| **K6** | 4GB | 4.0 | For high-concurrency load tests (multiple VUs) |
| **Process Limits** | — | — | `--pids-limit=256` for parallel browser instances |
| **Shared Memory** | 2GB | — | `--shm-size=2048m` for browser/ffmpeg operations |

**Worker Container Resource Allocation (docker-compose deployment):**

| Environment | CPU Limits | Memory Limits | CPU Reservations | Memory Reservations |
|-------------|-----------|---------------|------------------|-------------------|
| **Production** (docker-compose.yml) | 5.0 | 6GB | 1.0 | 2GB |
| **Staging/Secure** (docker-compose-secure.yml) | 5.0 | 6GB | 1.0 | 2GB |
| **External** (docker-compose-external.yml) | 5.0 | 6GB | 1.0 | 2GB |
| **Local Dev** (docker-compose-local.yml) | 5.0 | 6GB | 1.0 | 2GB |

Worker container resources provide overhead for:
- Docker socket communication with execution containers
- Report extraction and processing
- Redis/Database connections
- Concurrent container orchestration

**Environment variables to tune:**
- `TEST_EXECUTION_TIMEOUT_MS=300000` (Test timeout in milliseconds, default 5 min)
- `MAX_CONCURRENT_EXECUTIONS=1` (Single Playwright container execution per worker)
- `PLAYWRIGHT_WORKERS=2` (Parallel test execution within container)
- `K6_MAX_CONCURRENCY=1` (Single k6 test container per worker)
- `RUNNING_CAPACITY=6` (Global queue system parallelism, 3 replicas × 2 concurrent)
- `QUEUED_CAPACITY=50` (Queue depth limit)

**Playwright Performance Tuning:**
- **Test Timeout**: 240s per individual test (global timeout 5 minutes)
- **Worker Count**: 2 workers run tests in parallel inside container
- **Retry Strategy**: 1 retry on failure
- **Expected throughput**: 2 parallel workers × multiple tests = 1.5-2x faster execution
- **Container Resources**: 4GB RAM, 4 CPUs per execution container (increased from 2GB/2CPU)

**K6 Performance Tuning:**
- **VU Limit**: 100-500 concurrent virtual users depending on endpoint complexity
- **Container Resources**: 4GB RAM, 4 CPUs per execution container
- **Expected throughput**: Can handle high-concurrency load tests efficiently
- **Shared Memory**: 2GB for dashboard exports and data processing

**Tuning Guidelines:**
- Increase `MAX_CONCURRENT_EXECUTIONS` if worker has spare resources (CPU/RAM)
- Increase `PLAYWRIGHT_WORKERS` for faster test execution (requires more memory)
- Increase `TEST_EXECUTION_TIMEOUT_MS` if tests consistently timeout
- Adjust `RUNNING_CAPACITY` based on available system resources (scale horizontally with replicas)
- Monitor queue depth to detect bottlenecks
- Each worker replica requires: 5 CPUs limit, 6GB memory limit (for orchestration)

### Key Performance Metrics

| Metric | Target | Current | Status | Notes |
|--------|--------|---------|--------|-------|
| Queue Wait Time | < 30s | 15s avg | ✅ | BullMQ with efficient queue processing |
| Test Execution Time (Playwright) | < 2 min | 1.0-1.5 min avg | ✅ | 2 parallel workers per container |
| Test Execution Time (K6) | < 10 min | 5-8 min avg | ✅ | High-concurrency load testing |
| Artifact Upload Time | < 10s | 8s avg | ✅ | S3/MinIO transfer with optimized chunks |
| Worker Utilization | 70-80% | 75% avg | ✅ | 3 replicas with balanced load |
| Memory per Container | 4GB | 4GB (Playwright/K6) | ✅ | Increased from 2GB for stable execution |
| CPU per Container | 4.0 | 4.0 (Playwright/K6) | ✅ | Increased from 2.0 for parallel workers |
| Concurrent Executions | 2 per worker | 2 | ✅ | Scale horizontally with replicas |
| Global Throughput (3 replicas) | 6 concurrent | 6 | ✅ | 3 workers × 2 concurrent executions |

### Redis Memory Management

- Completed jobs kept for 24 hours (500 max)
- Failed jobs kept for 7 days (1000 max)
- Metrics limited to 60 data points (1 hour at 1 min interval)
- Stalled job check every 30 seconds
- Automatic cleanup of orphaned keys
- TTL-based expiration for all keys

---

## Monitoring & Observability

### Queue Monitoring

**Queue Statistics:**
- Running: current active jobs / capacity
- Queued: current waiting jobs / capacity
- Check if system is at capacity
- Monitor queue depth trends

**Health Checks:**
- Stalled job detection: Every 30 seconds
- Failed job tracking: 7-day retention
- Completed job tracking: 24-hour retention
- Metrics collection: 60 data points per queue

### Artifact Storage Monitoring

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

---

## Configuration Reference

### Environment Variables

**Capacity Configuration:**
- `RUNNING_CAPACITY` - Maximum concurrent executions (default: 5)
- `QUEUED_CAPACITY` - Maximum queued jobs (default: 50)
- `MAX_CONCURRENT_EXECUTIONS` - Per-worker concurrency (default: 1)

> **Note:** These defaults are placeholders. When subscription-aware capacity management ships, limits will be derived from organization settings stored in the database.

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

---

## Summary

The execution system provides:

✅ **Distributed capacity management** via Redis
✅ **Container-based execution** with automatic cleanup
✅ **Multi-location support** for K6 and monitors
✅ **Reliable job processing** with retry logic
✅ **Comprehensive artifact management** via S3
✅ **Scalable architecture** supporting multiple execution types
✅ **No local folder accumulation** - containers handle cleanup
✅ **Global monitoring coverage** with location-based execution
✅ **Horizontal scaling** for high throughput
✅ **Security isolation** with containerized environments

