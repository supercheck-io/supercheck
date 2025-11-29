# Job Trigger System Specification

## Overview

The Supercheck Job Trigger System provides three distinct execution pathways: **Manual** (user-initiated), **Remote** (API-driven), and **Schedule** (automated). This multi-trigger architecture enables seamless integration with CI/CD pipelines, automated testing workflows, and interactive development scenarios while maintaining complete execution traceability and audit compliance.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Trigger Types](#trigger-types)
3. [Execution Flow](#execution-flow)
4. [Capacity Management](#capacity-management)
5. [Security & Authorization](#security--authorization)
6. [Database Schema](#database-schema)
7. [API Endpoints](#api-endpoints)
8. [Integration Patterns](#integration-patterns)

## System Architecture

```mermaid
graph TB
    subgraph "🎨 Trigger Sources"
        M1[👤 Web UI<br/>Manual Trigger]
        R1[🔗 External API<br/>Remote Trigger]
        S1[⏰ Cron Scheduler<br/>Schedule Trigger]
    end

    subgraph "🔐 Authentication Layer"
        AUTH1[Session Auth<br/>Manual]
        AUTH2[API Key Auth<br/>Remote]
        AUTH3[Internal Auth<br/>Schedule]
    end

    subgraph "⚙️ Processing Pipeline"
        VALIDATE[Capacity Check<br/>& Validation]
        QUEUE[BullMQ Queue<br/>Job Placement]
        WORKER[Worker Service<br/>Test Execution]
    end

    subgraph "💾 State Management"
        DB[(PostgreSQL<br/>Run Records)]
        CACHE[Redis<br/>Capacity Tracking]
    end

    subgraph "📊 Real-time Updates"
        SSE[Server-Sent Events<br/>Real-time Updates]
    end

    M1 --> AUTH1
    R1 --> AUTH2
    S1 --> AUTH3

    AUTH1 & AUTH2 & AUTH3 --> VALIDATE
    VALIDATE --> CACHE
    VALIDATE --> QUEUE
    QUEUE --> WORKER

    WORKER --> DB
    QUEUE --> SSE

    classDef source fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef auth fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef process fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef data fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef obs fill:#fce4ec,stroke:#c2185b,stroke-width:2px

    class M1,R1,S1 source
    class AUTH1,AUTH2,AUTH3 auth
    class VALIDATE,QUEUE,WORKER process
    class DB,CACHE data
    class SSE obs
```

## Trigger Types

### Manual Trigger

**Purpose:** Interactive job execution initiated by authenticated users through the web interface.

**Characteristics:**
- Real-time user feedback
- Immediate capacity validation
- Session-based authentication
- SSE progress updates
- User-specific RBAC enforcement

**Use Cases:**
- Development and debugging
- Ad-hoc test runs
- Manual regression testing
- Interactive test exploration

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant API
    participant Queue
    participant Worker

    User->>Frontend: Click "Run Job"
    Frontend->>API: POST /api/jobs/run
    API->>API: Validate session
    API->>API: Check RBAC permissions
    API->>API: Verify capacity

    alt Capacity Available
        API->>Queue: Add job (trigger: manual)
        Queue-->>API: Job queued
        API-->>Frontend: 200 {runId, status}
        Frontend->>Frontend: Open SSE connection
        Queue->>Worker: Process job
        Worker->>Worker: Execute tests
        Worker-->>Frontend: SSE updates
        Worker-->>User: Completion notification
    else No Capacity
        API-->>Frontend: 429 Capacity Exceeded
        Frontend-->>User: Show retry message
    end
```

### Remote Trigger

**Purpose:** Programmatic job execution via API keys for CI/CD integration and external automation.

**Characteristics:**
- API key authentication
- Rate limiting per key
- No user session required
- Webhook-friendly
- Support for job parameters

**Use Cases:**
- CI/CD pipeline integration
- Pre-deployment validation
- Scheduled external triggers
- Third-party integrations

```mermaid
sequenceDiagram
    participant CI_CD
    participant API
    participant DB
    participant Queue
    participant Worker

    CI_CD->>API: POST /api/jobs/:id/trigger<br/>Authorization: Bearer [api-key]
    API->>API: Extract API key
    API->>DB: Validate API key

    alt Valid API Key
        DB-->>API: Key valid, jobId matches
        API->>API: Check rate limit
        API->>API: Check capacity

        alt Within Limits
            API->>Queue: Add job (trigger: remote)
            Queue-->>API: Job queued
            API-->>CI_CD: 200 {runId, message}
            Queue->>Worker: Process job
            Worker->>Worker: Execute tests
            Worker-->>CI_CD: Optional webhook callback
        else Rate Limited
            API-->>CI_CD: 429 Rate Limit Exceeded
        end
    else Invalid Key
        API-->>CI_CD: 401 Unauthorized
    end
```

### Schedule Trigger

**Purpose:** Automated time-based job execution using cron expressions.

**Characteristics:**
- Cron-based scheduling
- No external authentication
- System-initiated execution
- Configurable retry logic
- Prevents concurrent executions

**Use Cases:**
- Continuous monitoring
- Nightly regression suites
- Periodic smoke tests
- Regular health checks

```mermaid
sequenceDiagram
    participant Cron
    participant Scheduler
    participant DB
    participant Queue
    participant Worker

    Cron->>Scheduler: Cron expression triggered
    Scheduler->>DB: Fetch jobs with schedules

    loop For each scheduled job
        Scheduler->>DB: Check last run time
        Scheduler->>DB: Check if currently running

        alt Ready to Run
            Scheduler->>Queue: Add job (trigger: schedule)
            Queue-->>Scheduler: Job queued
            Scheduler->>DB: Update next run time
            Queue->>Worker: Process job
            Worker->>Worker: Execute tests
            Worker->>DB: Save results
        else Already Running
            Scheduler->>Scheduler: Skip (prevent duplicate)
        end
    end
```

## Execution Flow

### Complete Job Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Triggered: User/API/Schedule
    Triggered --> Validating: Authenticate

    Validating --> Rejected: Auth Failed
    Validating --> CheckingCapacity: Auth Success

    CheckingCapacity --> Queued: Capacity Available
    CheckingCapacity --> Rejected: No Capacity

    Queued --> Waiting: In Queue
    Waiting --> Active: Worker Picks Up

    Active --> Running: Tests Executing
    Running --> Uploading: Tests Complete
    Uploading --> Completed: Artifacts Saved
    Running --> Failed: Test Error

    Completed --> [*]
    Failed --> [*]
    Rejected --> [*]
```

### Trigger-Specific Paths

```mermaid
graph LR
    A[Trigger Initiated] --> B{Trigger Type?}

    B -->|Manual| C1[Session Validation]
    B -->|Remote| C2[API Key Validation]
    B -->|Schedule| C3[Internal Validation]

    C1 --> D1[User RBAC Check]
    C2 --> D2[Rate Limit Check]
    C3 --> D3[Duplicate Check]

    D1 & D2 & D3 --> E[Capacity Check]
    E --> F[Add to Queue]
    F --> G[Worker Execution]

    classDef manual fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef remote fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef schedule fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef common fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class C1,D1 manual
    class C2,D2 remote
    class C3,D3 schedule
    class E,F,G common
```

## Capacity Management

### Atomic Capacity Enforcement

**✅ Race Condition Prevention**
- All job triggers (Manual, Remote, Schedule) use atomic capacity management
- Redis Lua scripts prevent concurrent requests from exceeding limits
- Organization-specific capacity limits enforced at the trigger point

### Capacity Tracking Architecture

```mermaid
graph TB
    A[Job Trigger Request] --> CM[Capacity Manager]
    CM --> B{"reserveSlot(organizationId)"}

    subgraph "Redis Atomic Counters"
        C["capacity:running:{orgId}<br/>Current: 4"]
        D["capacity:queued:{orgId}<br/>Current: 15"]
        E["Plan Limits<br/>Plus: 5/50, Pro: 10/100"]
    end

    B --> Lua[Lua Script<br/>Atomic Check + Increment]
    Lua --> C & D & E

    Lua --> F{Slot Reserved?}
    F -->|No| G[❌ 429 Error]
    F -->|Yes| H[✅ Add to Queue]

    subgraph "Job Event Management"
        I[active event<br/>queued→running]
        J[completed event<br/>release running]
        K[failed event<br/>release running/queued]
        L[stalled event<br/>release running]
    end

    H --> I & J & K & L

    classDef check fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef redis fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef success fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef reject fill:#ffcdd2,stroke:#c62828,stroke-width:2px
    classDef event fill:#e3f2fd,stroke:#1976d2,stroke-width:2px

    class CM,B,F check
    class C,D,E redis
    class H,I,J,K,L success
    class G reject
```

### Capacity Limits by Plan

| Plan | Running Capacity | Queued Capacity | Scope |
|------|------------------|-----------------|-------|
| **Plus** | 5 concurrent | 50 queued | Organization |
| **Pro** | 10 concurrent | 100 queued | Organization |
| **Unlimited** | 999 concurrent | 9999 queued | Organization |

**Environment Overrides (Self-hosted):**
- `RUNNING_CAPACITY`: Override plan-specific running limit
- `QUEUED_CAPACITY`: Override plan-specific queued limit |
| **Queued Capacity** | 50 | `QUEUED_CAPACITY` | Global |
| **Execution Timeout** | 15 min | `JOB_EXECUTION_TIMEOUT_MS` | Per Job |
| **Max Concurrent Tests** | 1 | `MAX_CONCURRENT_EXECUTIONS` | Per Worker |

## Security & Authorization

### Authorization Matrix

```mermaid
graph TB
    A[Trigger Request] --> B{Trigger Type}

    B -->|Manual| C1[Session Check]
    B -->|Remote| C2[API Key Check]
    B -->|Schedule| C3[Internal Auth]

    C1 --> D1{Valid Session?}
    D1 -->|No| E1[401 Unauthorized]
    D1 -->|Yes| F1[RBAC Check]

    F1 --> G1{Has job:execute?}
    G1 -->|No| H1[403 Forbidden]
    G1 -->|Yes| I[Proceed to Execution]

    C2 --> D2{Valid API Key?}
    D2 -->|No| E2[401 Invalid Key]
    D2 -->|Yes| F2[Job Match Check]

    F2 --> G2{Key for this job?}
    G2 -->|No| H2[403 Wrong Job]
    G2 -->|Yes| F3[Rate Limit Check]

    F3 --> G3{Within Limit?}
    G3 -->|No| H3[429 Rate Limited]
    G3 -->|Yes| I

    C3 --> D3{Internal Token?}
    D3 -->|No| E3[401 Unauthorized]
    D3 -->|Yes| F4[Schedule Check]

    F4 --> G4{Schedule Active?}
    G4 -->|No| H4[400 Disabled]
    G4 -->|Yes| I

    classDef error fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef check fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef success fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class E1,E2,E3,H1,H2,H3,H4 error
    class D1,D2,D3,F1,F2,F3,F4,G1,G2,G3,G4 check
    class I success
```

### Security Considerations by Trigger Type

| Security Aspect | Manual | Remote | Schedule |
|----------------|--------|--------|----------|
| **Authentication** | Session cookie | Bearer token | Internal JWT |
| **Authorization** | RBAC + Project membership | API key → Job mapping | System-level |
| **Rate Limiting** | Per user (10/min) | Per API key (configurable) | N/A |
| **Audit Logging** | User ID + timestamp | API key ID + IP | System + cron ID |
| **CSRF Protection** | Required | N/A | N/A |
| **Polar Validation** | Yes | Yes | No (internal) |

### Security Enhancements

#### **Remote Trigger Security**

1. **Polar Customer Validation**
   - All remote triggers validate that the organization has a valid Polar customer
   - Blocks execution for deleted/invalid Polar customers with clear error message
   - Returns HTTP 402 for subscription/customer issues

2. **Atomic API Key Counter**
   - API key usage statistics updated atomically using SQL `COALESCE + INCREMENT`
   - Prevents race conditions from concurrent requests overwriting counts
   - Non-blocking: failures don't prevent job execution

3. **Safe Logging**
   - Organization IDs truncated in logs to prevent data exposure
   - API key names logged but not full key values
   - Error messages sanitized before returning to client

## Database Schema

### Runs Table Structure

```mermaid
erDiagram
    RUNS ||--o{ RUN_RESULTS : contains
    RUNS }o--|| JOBS : belongs_to
    RUNS }o--|| USERS : initiated_by
    RUNS }o--o| API_KEYS : triggered_by

    RUNS {
        uuid id PK
        uuid jobId FK
        uuid userId FK
        uuid apiKeyId FK
        string trigger "manual|remote|schedule"
        string status
        timestamp startedAt
        timestamp completedAt
        jsonb metadata
        timestamp createdAt
    }

    JOBS {
        uuid id PK
        string name
        boolean scheduled
        string cronExpression
        timestamp nextRunAt
    }

    API_KEYS {
        uuid id PK
        uuid jobId FK
        string key
        boolean enabled
    }
```

### Trigger Field Specification

**Field:** `trigger`
**Type:** `varchar(50)`
**Default:** `'manual'`
**Values:**
- `manual` - User-initiated via web UI
- `remote` - API-triggered via API key
- `schedule` - Cron-based automation

**Indexes:**
- `idx_runs_trigger` - Fast filtering by trigger type
- `idx_runs_job_trigger` - Composite index for job + trigger queries
- `idx_runs_created_trigger` - Timeline queries by trigger type

## API Endpoints

### Manual Trigger

**Endpoint:** `POST /api/jobs/run`

**Authentication:** Session cookie

**Request Body:**
```json
{
  "jobId": "uuid",
  "metadata": {}
}
```

**Response:**
```json
{
  "runId": "uuid",
  "status": "queued",
  "trigger": "manual",
  "message": "Job queued successfully"
}
```

### Remote Trigger

**Endpoint:** `POST /api/jobs/:id/trigger`

**Authentication:** Bearer token (API key)

**Headers:**
```
Authorization: Bearer job_abc123...
```

**Response:**
```json
{
  "runId": "uuid",
  "jobId": "uuid",
  "status": "queued",
  "trigger": "remote",
  "message": "Job queued successfully"
}
```

### Schedule Management

**Endpoint:** `PATCH /api/jobs/:id/schedule`

**Request Body:**
```json
{
  "scheduled": true,
  "cronExpression": "0 2 * * *",
  "timezone": "America/New_York"
}
```

## Integration Patterns

### CI/CD Integration

```mermaid
sequenceDiagram
    participant GitHub
    participant GitHubActions
    participant Supercheck
    participant Slack

    GitHub->>GitHubActions: Push to main
    GitHubActions->>GitHubActions: Build & Test

    alt Build Success
        GitHubActions->>Supercheck: POST /api/jobs/:id/trigger<br/>API Key Auth
        Supercheck-->>GitHubActions: Job queued

        loop Poll Status (or use webhook)
            GitHubActions->>Supercheck: GET /api/runs/:runId
            Supercheck-->>GitHubActions: Status update
        end

        Supercheck->>Slack: Test results notification

        alt Tests Pass
            GitHubActions->>GitHubActions: Deploy to production
        else Tests Fail
            GitHubActions->>GitHub: Block deployment
        end
    end
```

### Automated Monitoring

```mermaid
graph TB
    A[Cron Schedule] -->|Every Hour| B[Monitor Job]
    B --> C[Health Check Tests]
    C --> D{All Pass?}

    D -->|Yes| E[Update Status Page<br/>Operational]
    D -->|No| F[Alert On-Call Engineer]

    F --> G[Create Incident]
    G --> H[Send Notifications]
    H --> I[Email + Slack + PagerDuty]

    E --> J[Record Metrics]
    F --> J

    J --> K[Update Dashboard]

    classDef success fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef alert fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef monitor fill:#e3f2fd,stroke:#1976d2,stroke-width:2px

    class A,B,C,J,K monitor
    class E success
    class F,G,H,I alert
```

## Best Practices

### For Manual Triggers
- Provide clear feedback on queue position
- Show estimated wait time
- **Allow cancellation of queued and running jobs**
- Display capacity status before trigger

## Job Cancellation

### Overview

Users can cancel running or queued jobs via the **Cancel API**. Cancellation uses Redis-based signaling to communicate between the app and distributed workers.

### Cancellation Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Jobs UI
    participant API as Cancel API
    participant Redis
    participant Worker
    participant Container

    User->>UI: Click "Cancel" button
    UI->>API: POST /api/runs/{runId}/cancel
    API->>API: Validate RBAC permissions
    API->>Redis: SET supercheck:cancel:{runId} = 1
    
    alt Job Waiting in Queue
        API->>API: Remove from BullMQ queue
        API->>API: Update DB status → error
    else Job Running
        API->>API: Update DB status → error
        Worker->>Redis: Poll every 1 second
        Redis-->>Worker: Cancellation detected
        Worker->>Container: docker kill
        Worker->>Redis: Clear cancellation signal
    end
    
    API-->>UI: { success: true }
    UI-->>User: Show "Cancelled" status
```

### API Endpoint

**Endpoint:** `POST /api/runs/:runId/cancel`

**Authentication:** Session cookie (same as Manual Trigger)

**Response:**
```json
{
  "success": true,
  "message": "Run cancelled successfully",
  "runId": "uuid",
  "queueRemoved": true,
  "jobType": "playwright"
}
```

### Cancellation States

| Original State | After Cancel | Notes |
|----------------|--------------|-------|
| `pending` | `error` | Removed from queue |
| `running` | `error` | Container killed (exit code 137) |
| `passed` | N/A | Cannot cancel completed |
| `failed` | N/A | Cannot cancel completed |
| `error` | N/A | Cannot cancel completed |

### UI Confirmation Dialog

Before cancelling, users see a confirmation dialog:
- **Title**: "Cancel Execution?"
- **Description**: "Are you sure you want to cancel this job execution? This action cannot be undone and the run will be marked as cancelled."
- **Actions**: "Continue Running" (cancel) or "Cancel Execution" (confirm)

### UI Status Display

Cancelled runs display as "Cancelled" (not "Error") in the UI:
- Database stores `status: 'error'` with `errorDetails: 'Cancellation requested by user'`
- UI detects cancellation keywords in `errorDetails` and displays "Cancelled" with Ban icon
- Faceted filters correctly count cancelled runs separately from other errors

### Implementation Details

- **Redis Signal TTL**: 1 hour (prevents stale signals)
- **Polling Interval**: 1 second during container execution
- **Container Kill**: Uses `docker kill` (SIGKILL) for immediate termination
- **Cleanup**: Container removed, resources released automatically

## Queue Status Synchronization

### Overview

To prevent jobs from getting "stuck" in a `running` state due to worker crashes or unexpected terminations, the system implements **active queue verification** that synchronizes database status with the actual BullMQ queue state.

### Synchronization Mechanism

```mermaid
sequenceDiagram
    participant UI as Jobs UI
    participant API as Status API
    participant DB as PostgreSQL
    participant Queue as BullMQ/Redis
    
    UI->>API: GET /api/jobs/status/running
    API->>DB: Query runs with status='running'
    
    loop For Each Running Job
        API->>Queue: getJob(runId)
        Queue-->>API: Job state or null
        
        alt Job Running in Queue
            API->>API: Mark as valid
        else Job Not in Queue
            API->>DB: UPDATE status='error'
            API->>API: Mark as stale
        end
    end
    
    API-->>UI: Return only valid running jobs
```

### When It Runs

- **On Page Load**: `/api/jobs/status/running` is called by `JobContext` 
- **On Refresh**: Ensures UI always shows accurate state
- **Automatic**: No manual intervention required

### How It Works

**Implementation:** `app/src/app/api/jobs/status/running/route.ts`

1. **Query Database**: Get all runs with `status: 'running'`
2. **Verify with Queue**: For each run, check if job exists in BullMQ queues:
   - Check Playwright global queue
   - Check K6 regional queues
   - Use `queue.getJob(runId)` and `job.getState()`
3. **Detect Inconsistencies**: If queue says job is completed/failed/missing but DB says "running"
4. **Sync Database**: Immediately update stale runs to `error` status
5. **Return Valid Jobs**: Only return jobs that are truly running

### Performance Optimization

- **Parallel Batch Queries**: Checks all runs concurrently using `Promise.all()`
- **Early Exit**: Uses `Promise.race()` to return as soon as job is found in any queue
- **Timeout Protection**: 500ms timeout per run to prevent hanging
- **Complexity**: O(N) instead of O(N×M) where N=runs, M=queues

### Error Messages

Stale jobs are marked with:
```typescript
{
  status: "error",
  errorDetails: "Job status inconsistency detected - not found in execution queue",
  completedAt: <current timestamp>
}
```

### Benefits

- ✅ **Self-Healing**: System automatically fixes stuck jobs
- ✅ **No Background Service**: Simple, synchronous verification
- ✅ **Real-time**: Updates happen on every page load
- ✅ **User Transparency**: Users immediately see accurate status


### For Remote Triggers
- Implement exponential backoff on 429 responses
- Use webhook callbacks instead of polling
- Set appropriate API key rate limits
- Monitor API key usage patterns

### For Schedule Triggers
- Use timezone-aware cron expressions
- Prevent overlapping executions
- Implement schedule drift detection
- Log all schedule changes

## Related Documentation

- **API Keys:** See `API_KEY_SYSTEM.md` for detailed API key documentation
- **Queue System:** See `EXECUTION_SYSTEM.md` for queue details
- **Authentication:** See `AUTHENTICATION.md` for auth mechanisms

