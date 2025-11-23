# Data Lifecycle System - Cleanup & Retention Management

## Overview

The Supercheck data lifecycle system provides **enterprise-grade cleanup operations** for managing data retention, archival, and resource cleanup across all entities. The system uses **BullMQ** for distributed job processing and supports **configurable retention policies** per entity type.

**🔄 Automated Cleanup:** Scheduled cleanup jobs run during off-peak hours to maintain optimal database and storage performance.

**🔒 Safe by Design:** Dry-run mode, batch processing, and safety limits prevent accidental data loss.

---

## System Architecture

### Complete Architecture Overview

```mermaid
graph TB
    subgraph "🗓️ Schedulers"
        S1[Monitor Results Cleanup<br/>Cron: 2 AM Daily]
        S2[Job Runs Cleanup<br/>Cron: 3 AM Daily]
        S3[Playground Cleanup<br/>Cron: Every 12 Hours]
    end

    subgraph "⚙️ Data Lifecycle Service"
        DLS[Main Orchestrator<br/>Manages all cleanup strategies]
        REG[Strategy Registry<br/>Monitor, Job, Playground]
        QUEUE[BullMQ Queue<br/>data-lifecycle-cleanup]
    end

    subgraph "🧹 Cleanup Strategies"
        CS1[Monitor Results Strategy<br/>Retention: 30 days]
        CS2[Job Runs Strategy<br/>Retention: 90 days]
        CS3[Playground Strategy<br/>Retention: 24 hours]
    end

    subgraph "💾 Storage Targets"
        DB[(PostgreSQL<br/>Delete old records)]
        S3[MinIO/S3<br/>Delete artifacts]
        REDIS[(Redis<br/>Clear cache)]
    end

    S1 & S2 & S3 --> DLS
    DLS --> REG
    REG --> QUEUE
    QUEUE --> CS1 & CS2 & CS3

    CS1 --> DB
    CS2 --> DB & S3
    CS3 --> S3

    classDef scheduler fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef service fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef strategy fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef storage fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class S1,S2,S3 scheduler
    class DLS,REG,QUEUE service
    class CS1,CS2,CS3 strategy
    class DB,S3,REDIS storage
```

---

## Cleanup Strategies

### Strategy Overview

```mermaid
graph LR
    subgraph "Cleanup Strategies"
        M[Monitor Results<br/>✅ Enabled by default<br/>30 days retention]
        J[Job Runs<br/>❌ Disabled by default<br/>90 days retention]
        P[Playground<br/>❌ Disabled by default<br/>24 hours retention]
    end

    M --> MD[Delete old check results<br/>Preserve status changes]
    J --> JD[Delete run records<br/>Delete S3 artifacts<br/>Delete reports]
    P --> PD[Delete S3 artifacts<br/>Delete temp files]

    classDef enabled fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef disabled fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef action fill:#e3f2fd,stroke:#1976d2,stroke-width:2px

    class M enabled
    class J,P disabled
    class MD,JD,PD action
```

### 1. Monitor Results Cleanup

**Configuration:**
- **Entity Type:** monitor_results
- **Status:** ✅ Enabled by default
- **Schedule:** 2 AM daily (0 2 * * *)
- **Retention:** 30 days
- **Batch Size:** 1000 records
- **Safety Limit:** 1,000,000 records

**Environment Variables:**
- `MONITOR_CLEANUP_ENABLED`: true
- `MONITOR_CLEANUP_CRON`: "0 2 * * *"
- `MONITOR_RETENTION_DAYS`: 30
- `MONITOR_CLEANUP_BATCH_SIZE`: 1000
- `MONITOR_CLEANUP_SAFETY_LIMIT`: 1000000

**What Gets Deleted:**
- ✅ Old monitor check results (older than 30 days)
- ❌ Status change records (preserved for alert history)
- ❌ Recent results (within 30 days)

### 2. Job Runs Cleanup

**Configuration:**
- **Entity Type:** job_runs
- **Status:** ❌ Disabled by default (opt-in)
- **Schedule:** 3 AM daily (0 3 * * *)
- **Retention:** 90 days
- **Batch Size:** 100 records
- **Safety Limit:** 10,000 records

**Environment Variables:**
- `JOB_RUNS_CLEANUP_ENABLED`: false
- `JOB_RUNS_CLEANUP_CRON`: "0 3 * * *"
- `JOB_RUNS_RETENTION_DAYS`: 90
- `JOB_RUNS_CLEANUP_BATCH_SIZE`: 100
- `JOB_RUNS_CLEANUP_SAFETY_LIMIT`: 10000

**What Gets Deleted:**
- ✅ Old run records (older than 90 days)
- ✅ Associated reports from reports table
- ✅ S3 artifacts (reports, traces, screenshots)
- ❌ Recent runs (within 90 days)

### 3. Playground Artifacts Cleanup

**Configuration:**
- **Entity Type:** playground_artifacts
- **Status:** ❌ Disabled by default (opt-in)
- **Schedule:** Every 12 hours (0 */12 * * *)
- **Retention:** 24 hours
- **S3 Bucket:** playwright-test-artifacts

**Environment Variables:**
- `PLAYGROUND_CLEANUP_ENABLED`: false
- `PLAYGROUND_CLEANUP_CRON`: "0 */12 * * *"
- `PLAYGROUND_CLEANUP_MAX_AGE_HOURS`: 24
- `S3_TEST_BUCKET_NAME`: "playwright-test-artifacts"

**What Gets Deleted:**
- ✅ S3 playground artifacts older than 24 hours
- ✅ Test reports from playground executions
- ✅ Screenshots and traces from playground tests
- ❌ Recent playground artifacts

---

## Cleanup Execution Flow

### Scheduled Cleanup Flow

```mermaid
sequenceDiagram
    participant Cron as Cron Scheduler
    participant Queue as BullMQ Queue
    participant Worker as Cleanup Worker
    participant Strategy as Cleanup Strategy
    participant DB as PostgreSQL
    participant S3 as MinIO/S3

    Cron->>Queue: Trigger at scheduled time
    Queue->>Worker: Pick up job
    Worker->>Strategy: Get strategy for entity type
    Strategy->>Strategy: Calculate cutoff date

    alt Monitor Results
        Strategy->>DB: Query old monitor results
        DB-->>Strategy: Old records
        loop For each batch
            Strategy->>DB: Delete batch (1000 records)
            Strategy->>Strategy: Wait 100ms
        end
    else Job Runs
        Strategy->>DB: Query old job runs
        DB-->>Strategy: Old runs + associated reports
        loop For each batch
            Strategy->>S3: Delete S3 artifacts
            Strategy->>DB: Delete report records
            Strategy->>DB: Delete run records
        end
    else Playground
        Strategy->>S3: List playground objects
        S3-->>Strategy: Objects older than 24h
        loop For each batch
            Strategy->>S3: Delete old objects
        end
    end

    Strategy-->>Worker: Cleanup result
    Worker->>Queue: Log completion
    Worker->>Queue: Update metrics
    Queue->>Queue: Remove job
```

### Job Runs Cascading Deletion

```mermaid
graph TB
    A[Find Old Runs<br/>older than 90 days] --> B[Query Associated Reports]
    B --> C{Reports Found?}

    C -->|Yes| D[For Each Report]
    C -->|No| H[Delete Run Records]

    D --> E[Delete S3 Objects<br/>reports, traces, screenshots]
    E --> F[Delete Report Record<br/>from database]
    F --> G{More Reports?}
    G -->|Yes| D
    G -->|No| H

    H --> I[Delete Run Record<br/>from database]
    I --> J[Cleanup Complete]

    classDef query fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef delete fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef complete fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class A,B,C,G query
    class D,E,F,H,I delete
    class J complete
```

---

## Manual Cleanup & Dry-Run

### Manual Cleanup Trigger

```mermaid
sequenceDiagram
    participant Admin
    participant API as API Endpoint
    participant Service as Data Lifecycle Service
    participant Queue as BullMQ Queue
    participant Worker as Cleanup Worker

    Admin->>API: POST /api/cleanup/trigger<br/>{entityType, dryRun}
    API->>Service: triggerManualCleanup()
    Service->>Queue: Add cleanup job
    Queue->>Worker: Process job
    Worker->>Worker: Execute cleanup

    alt Dry-Run Mode
        Worker->>Worker: Query old records
        Worker->>Worker: Count what would be deleted
        Worker->>Worker: Skip actual deletion
    else Normal Mode
        Worker->>Worker: Delete records
        Worker->>Worker: Delete S3 objects
    end

    Worker-->>Service: Cleanup result
    Service-->>API: {success, recordsDeleted, duration}
    API-->>Admin: Response
```

### Dry-Run Mode Behavior

| Operation | Normal Mode | Dry-Run Mode |
|-----------|------------|------------|
| Query old records | ✅ Executed | ✅ Executed |
| Count records | ✅ Counted | ✅ Counted |
| Delete from DB | ✅ Deleted | ❌ Skipped |
| Delete from S3 | ✅ Deleted | ❌ Skipped |
| Return metrics | ✅ Returned | ✅ Returned |

---

## Statistics & Monitoring

### Cleanup Status Dashboard

```mermaid
graph TB
    subgraph "Cleanup Status"
        S[Status API<br/>GET /api/cleanup/status]
    end

    S --> E[Enabled Strategies<br/>Monitor Results ✅<br/>Job Runs ❌<br/>Playground ❌]
    S --> Q[Queue Statistics<br/>Waiting jobs<br/>Active jobs<br/>Completed jobs<br/>Failed jobs]
    S --> T[Strategy Statistics<br/>Total records<br/>Old records<br/>Deletion estimates]

    classDef status fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef info fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class S status
    class E,Q,T info
```

### Performance Metrics

**Cleanup Duration:**
- Monitor Results: ~5-30 seconds
- Job Runs: ~30-120 seconds (includes S3 deletion)
- Playground Artifacts: ~10-60 seconds

**Database Impact:**
- Batch size: 1000 records for monitors, 100 for jobs
- Delay between batches: 100ms
- Minimal impact on running queries

**S3 Impact:**
- Paginated listing: 1000 objects per request
- Batch deletion
- Minimal impact on S3 performance

---

## Error Handling

### Retry Strategy

```mermaid
stateDiagram-v2
    [*] --> FirstAttempt: Execute Cleanup
    FirstAttempt --> Success: Cleanup Successful
    FirstAttempt --> Failed: Error Occurred
    Failed --> Wait60s: Wait 60 seconds
    Wait60s --> SecondAttempt: Retry
    SecondAttempt --> Success: Cleanup Successful
    SecondAttempt --> PermanentFailure: Error Occurred Again
    Success --> [*]
    PermanentFailure --> [*]

    note right of Failed
        Exponential backoff
        2 retry attempts
        60s initial delay
    end note
```

### Common Errors

| Error | Cause | Resolution |
|-------|-------|-----------|
| "No strategy found" | Invalid entity type | Check entity type spelling |
| "Database connection failed" | DB unavailable | Check DB connection |
| "S3 cleanup had failures" | S3 permission/network issue | Check S3 credentials |
| "Cleanup queue not initialized" | Service not initialized | Call initialize() first |

---

## Configuration & Tuning

### Tuning Guidelines

**For High-Volume Environments:**
```mermaid
graph LR
    A[High Volume] --> B[Increase Batch Size<br/>2000-5000 records]
    A --> C[More Frequent Cleanup<br/>Every 6 hours]
    A --> D[Shorter Retention<br/>14-30 days]
    A --> E[Higher Safety Limits<br/>5-10 million]

    classDef config fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    class B,C,D,E config
```

**For Low-Volume Environments:**
```mermaid
graph LR
    A[Low Volume] --> B[Smaller Batches<br/>500-1000 records]
    A --> C[Less Frequent Cleanup<br/>Weekly]
    A --> D[Longer Retention<br/>90-180 days]
    A --> E[Lower Safety Limits<br/>100k-500k]

    classDef config fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    class B,C,D,E config
```

---

## Best Practices

### Implementation Checklist

```mermaid
graph TB
    START[Enable Cleanup] --> STEP1{Test with Dry-Run?}
    STEP1 -->|No| WARNING[⚠️ Always test first!]
    STEP1 -->|Yes| STEP2[Review records to delete]

    WARNING --> STEP2

    STEP2 --> STEP3[Enable Monitor Cleanup<br/>Safest strategy]
    STEP3 --> STEP4{Monitor for 1 week}
    STEP4 -->|Issues| FIX[Adjust configuration]
    STEP4 -->|No Issues| STEP5[Enable Job Runs Cleanup]

    FIX --> STEP4

    STEP5 --> STEP6{Monitor for 1 week}
    STEP6 -->|Issues| FIX2[Adjust configuration]
    STEP6 -->|No Issues| STEP7[Enable Playground Cleanup]

    FIX2 --> STEP6

    STEP7 --> STEP8[Monitor all strategies]
    STEP8 --> END[✅ Fully Enabled]

    classDef start fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef step fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef warning fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef end fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class START start
    class STEP1,STEP2,STEP3,STEP4,STEP5,STEP6,STEP7,STEP8 step
    class WARNING,FIX,FIX2 warning
    class END end
```

### Recommended Schedule

| Strategy | Schedule | Rationale |
|----------|----------|-----------|
| Monitor Results | 2 AM Daily | Off-peak hours, sufficient frequency |
| Job Runs | 3 AM Daily | After monitor cleanup, off-peak |
| Playground | Every 12 Hours | Short retention, frequent cleanup |

---

## Summary

The data lifecycle system provides:

✅ **Pluggable cleanup strategies** for different entity types
✅ **Distributed job queue** via BullMQ/Redis
✅ **Configurable retention policies** per entity
✅ **Dry-run support** for safe testing
✅ **Comprehensive error handling** with retries
✅ **Detailed metrics and logging** for monitoring
✅ **Cascading deletion** for related records
✅ **Batch processing** to minimize database impact
✅ **Safety limits** to prevent accidental mass deletion
✅ **Flexible scheduling** with cron patterns
