# Test Execution and Job Queue Flow

## Table of Contents

- [System Architecture](#system-architecture)
- [Execution Flow Diagram](#execution-flow-diagram)
- [Execution Sequence Diagram](#execution-sequence-diagram)
- [Parallel Execution System](#parallel-execution-system)
- [Key Components](#key-components)
- [Error Handling and Recovery](#error-handling-and-recovery)
- [Playground Cleanup System](#playground-cleanup-system)
- [Monitor Execution System](#monitor-execution-system)
- [Configuration Options](#configuration-options)
- [Start Services Quick Reference](#start-services-quick-reference)
- [Implementation Details](#implementation-details)
- [Production Best Practices](#production-best-practices)
- [Review and Recommendations](#review-and-recommendations)

This document explains the comprehensive end-to-end flow of test execution and job processing in Supercheck, including queue management, parallel execution, capacity limits, and reporting mechanisms for both single tests and multi-test jobs.

## System Architecture

The test execution system is built with a distributed architecture using the following components:

- **Frontend (Next.js)**: User interface for creating and running tests/jobs
- **API Layer**: NextJS API routes that handle test/job execution requests
- **Queue System**: BullMQ + Redis for job queuing
- **Worker Service**: NestJS service that processes queued tests
- **Storage**:
  - PostgreSQL database for metadata
  - Local filesystem for immediate test artifacts
  - MinIO/S3 for persistent storage of test reports and artifacts

## Execution Flow Diagram

```mermaid
flowchart TB
    subgraph "Frontend"
        A1[User Interface]
        B1[ReportViewer Component]
    end

    subgraph "API Layer"
        C1["API Test Route"]
        C2["API Jobs Run Route"]
        C3["API Test Results Route"]
        C4["Playground Cleanup API"]
        C5["Script Validation API"]
    end

    subgraph "Queue System"
        D1[Redis]
        D2[BullMQ]
        D3[Playground Cleanup Queue]
        D4[Monitor Execution Queue]
        D5[Job Scheduler Queue]
        D6[Monitor Scheduler Queue]
    end

    subgraph "Worker Service"
        E1[Worker Process]
        E2[Test Execution Service]
        E3[Report Generation]
        E4[Enhanced Validation Service]
        E5[General Validation Service]
        E6[Monitor Execution Service]
        E7[Job Scheduler Service]
        E8[Monitor Scheduler Service]
    end

    subgraph "Background Services"
        G1[Playground Cleanup Service]
        G2[S3 Cleanup Service]
        G3[Scheduled Cleanup Worker]
    end

    subgraph "Storage"
        F1[(PostgreSQL)]
        F2[Local Filesystem]
        F3[MinIO/S3]
    end

    A1 -->|Validate Script| C5
    C5 -->|Validation Response| A1
    A1 -->|Execute Test/Job| C1
    A1 -->|Execute Job| C2
    C1 -->|Queue Test| D2
    C2 -->|Queue Job| D2
    D2 <-->|Store Jobs| D1
    D2 -->|Process Jobs| E1
    D4 -->|Process Monitor Checks| E6
    D5 -->|Schedule Jobs| E7
    D6 -->|Schedule Monitors| E8
    E1 -->|Validate Monitor Config| E4
    E4 -->|Validation Response| E1
    E1 -->|Execute Tests| E2
    E2 -->|Generate Reports| E3
    E3 -->|Store Results| F2
    E3 -->|Upload Reports| F3
    E1 -->|Update Status| F1
    E1 -->|Publish Status Events| D1
    A1 -->|Poll Status via SSE| D1
    A1 -->|Fetch Reports| C3
    C3 -->|Retrieve Report Files| F3
    C3 -->|Return Report| B1
    F1 <-->|Store/Retrieve Metadata| C1
    F1 <-->|Store/Retrieve Metadata| C2
    F1 <-->|Retrieve Report Metadata| C3

    %% Playground Cleanup Flow
    G1 -->|Schedule Cleanup Jobs| D3
    D3 <-->|Store Cleanup Jobs| D1
    D3 -->|Process Cleanup| G3
    G3 -->|Batch Delete S3 Objects| G2
    G2 -->|Delete Reports| F3
    C4 -->|Manual Trigger| G1
    C4 -->|Status Check| G1
```

## Execution Sequence Diagram

```mermaid
sequenceDiagram
    participant Client as Browser Client
    participant NextFE as Next.js Frontend
    participant NextAPI as Next.js API Routes
    participant Redis as Redis (Queue + PubSub)
    participant NestJS as NestJS Worker Service
    participant S3 as S3/MinIO Storage
    participant DB as PostgreSQL Database
    participant PW as Playwright Test Runner

    %% Individual Test Execution Flow (e.g., Playground)
    Client->>NextFE: Submit test script
    NextFE->>NextAPI: POST /api/validate-script (pre-validation)
    NextAPI-->>NextFE: Validation response
    alt Validation fails
        NextFE-->>Client: Show validation error
    else Validation passes
        NextFE->>NextFE: Show loading toast notification
        NextFE->>NextAPI: POST /api/test
        NextAPI->>Redis: Add test to 'test-execution' queue
        NextAPI-->>NextFE: Return testId, success status
        NextFE->>NextAPI: Open SSE connection /api/test-status/events/[testId]
    end
    NextAPI->>Redis: Subscribe to test status and complete channels
    NextAPI-->>NextFE: Establish SSE stream

    %% Worker picks up test from queue
    Redis->>NestJS: TestExecutionProcessor receives test task
    activate NestJS
    NestJS->>Redis: Publish 'running' status with TTL
    Redis-->>NextAPI: Message: status='running'
    NextAPI-->>NextFE: SSE event: status='running'

    %% Test execution process
    NestJS->>NestJS: Validate test script
    NestJS->>NestJS: Create test run directory with unique ID
    NestJS->>NestJS: Enhance script with trace configuration
    NestJS->>NestJS: Write test to JavaScript file
    NestJS->>PW: Execute test with Playwright native runner
    activate PW
    PW-->>NestJS: Return execution results
    deactivate PW

    %% Handling test results
    NestJS->>NestJS: Search for reports in expected directories
    NestJS->>NestJS: Process report files to fix trace URLs
    NestJS->>S3: Upload test report/artifacts
    NestJS->>DB: Update test status & metadata
    NestJS->>Redis: Publish completion status with TTL
    Redis-->>NextAPI: Message: status='completed'/'failed'
    NextAPI-->>NextFE: SSE event: status='completed'/'failed'
    NextFE->>NextFE: Dismiss loading toast
    NextFE->>NextFE: Show success/error toast
    NextFE->>NextAPI: Close SSE connection
    NextFE->>NextFE: Display test results/report
```

## Test Execution Flow

### 1. Single Test Execution (Playground)

1. **User Initiates Test**:

   - User enters test code in the Playground UI
   - Clicks "Run Test" button

2. **API Request Processing**:

   - Frontend sends a POST request to `/api/test` with test code
   - API generates a unique test ID
   - Creates a run entry in the database with "pending" status
   - Adds the test to the BullMQ `test-execution` queue
   - Returns the test ID and report URL path to the frontend

3. **Worker Processing**:

   - The test execution worker picks up the queued test
   - Creates a temporary directory for test artifacts
   - Writes the test code to a JavaScript file
   - Executes the test using Playwright
   - Publishes real-time status updates via Redis pub/sub

4. **Report Generation**:

   - Playwright generates an HTML report with test results
   - The report includes screenshots, videos, and traces
   - Report is stored locally in the configured output directory
   - For persistence, the report is uploaded to S3/MinIO

5. **Status Updates**:

   - Worker updates the test status in the database
   - Publishes status updates via Redis for real-time updates
   - Frontend receives updates via Server-Sent Events (SSE)

6. **Report Viewing**:
   - Once test completes, frontend displays the report
   - The ReportViewer component fetches report via `/api/test-results`
   - API proxy handles authentication and fetches the report from S3/local storage

### 2. Job Execution Flow (Multiple Tests)

1. **User Initiates Job**:

   - User selects a job from the jobs UI
   - Clicks "Run" to execute the job

2. **API Request Processing**:

   - Frontend sends a POST request to `/api/jobs/run` with job ID
   - API fetches all test scripts associated with the job
   - Creates a run entry in the database with "pending" status
   - Updates the `last_run_at` timestamp in the jobs table
   - Adds the job to the BullMQ `job-execution` queue
   - Returns the run ID and initial report URL path to the frontend

3. **Worker Processing**:

   - The job execution worker picks up the queued job
   - Creates a run directory for the job's test artifacts
   - Writes each test script to separate JavaScript files
   - Executes all tests using Playwright (potentially in parallel)
   - Publishes real-time status updates via Redis pub/sub

4. **Report Generation**:

   - Playwright generates a combined HTML report
   - The report includes results for all tests in the job
   - Worker uploads the report and artifacts to S3/MinIO
   - Report metadata is stored in the database for quick lookup

5. **Status Updates**:

   - Worker updates the run status in the database
   - Publishes job status updates via Redis
   - Frontend receives updates via Server-Sent Events (SSE)

6. **Report Viewing**:
   - Once job completes, frontend displays the combined report
   - The ReportViewer component fetches report via `/api/test-results`
   - API proxy handles authentication and retrieves the report from S3

## Parallel Execution System

The application includes a sophisticated parallel execution system that provides real-time visibility into test and job execution while enforcing configurable capacity limits.

### Core Concepts

1. **Parallel Executions:** Each test or job run counts as a separate "execution" that consumes execution capacity.

2. **Capacity Limits:** The system enforces two primary limits:

   - **Running Capacity (default: 5):** Maximum number of concurrent executions that can run simultaneously.
   - **Queued Capacity (default: 50):** Maximum number of executions that can be queued when running capacity is full.

3. **Execution Flow:**
   - New executions are added to the running pool if capacity is available.
   - If running capacity is full, executions are placed in the queue.
   - If queued capacity is full, new submissions are rejected with a 429 (Too Many Requests) status code.
   - As running executions complete, queued executions are automatically moved to the running state.

### How Capacity Limits Are Enforced

The system enforces capacity limits at multiple levels:

1. **API Layer Enforcement (QUEUED_CAPACITY):**

   - Before adding a job to the queue, the API checks if queued capacity is exceeded
   - If queue is full, the API rejects the submission with a 429 status code
   - Prevents overloading the system with too many pending executions

2. **Worker Layer Enforcement (RUNNING_CAPACITY):**
   - Workers check running job count before processing each job
   - If running capacity is full, the job is delayed and returned to the queue
   - This ensures only the allowed number of jobs run simultaneously

These multi-level checks ensure the system maintains stability under heavy load while providing accurate UI feedback.

## Key Components

### 1. Queue System

The application uses BullMQ with Redis for job queuing:

- **Queues**:

  - `test-execution`: For single test executions
  - `job-execution`: For running multiple tests as part of a job
  - `monitor-execution`: For monitor checks triggered by schedulers
  - `job-scheduler`: For cron-driven job scheduling
  - `monitor-scheduler`: For cron-driven monitor scheduling
  - `playground-cleanup`: For scheduled cleanup of old playground test reports

- **Benefits**:
  - **Reliability**: Failed jobs can be retried
  - **Persistence**: Jobs survive application restarts
  - **Scalability**: Multiple workers can process jobs concurrently
  - **Monitoring**: Job progress and status tracking

### 2. Worker Service

The NestJS worker service processes queued jobs:

- **Processors**:

  - `TestExecutionProcessor`: Handles single test execution and enforces running capacity
  - `JobExecutionProcessor`: Handles job execution with multiple tests and enforces running capacity

- **Services**:
  - `ExecutionService`: Orchestrates test execution
  - `S3Service`: Handles artifact uploads to S3/MinIO
  - `DbService`: Manages database operations
  - `RedisService`: Handles real-time status updates and connection management
  - `QueueStatusService`: Manages Bull queue event listeners for monitoring
  - `MonitorService`: Handles monitor execution and alerting
  - `PlaygroundCleanupService`: Manages scheduled S3 cleanup with batch processing (1000 objects per batch) using BullMQ Worker

### 3. Report Storage and Retrieval

Test reports are stored in multiple locations:

- **Local Storage**:

  - Test results are initially stored on the local filesystem
  - Default locations are defined in the Playwright configuration

- **S3/MinIO Storage**:

  - Test reports and artifacts are uploaded for persistence
  - Organized by test/job IDs to allow easy retrieval
  - Accessible via the API layer or directly from S3 (if authenticated)

- **Database**:
  - Metadata about tests, runs, and reports is stored in PostgreSQL
  - Includes status, timestamps, URLs, and error information

### 4. Real-time Status Updates

Status updates use a publish/subscribe pattern:

- **Publishers**:

  - Worker service publishes status updates to Redis channels
  - Channels are named based on test/job IDs

- **Subscribers**:
  - Frontend subscribes to updates via Server-Sent Events (SSE)
  - Updates are used to show real-time progress and status

### 5. Validation Services

The system includes comprehensive validation services to ensure security and reliability:

- **Script Validation Service** (`ValidationService`):

  - Pre-execution validation of test scripts
  - Security checks for dangerous patterns and blocked identifiers
  - Module import validation (only allows approved libraries)
  - Syntax validation and complexity analysis
  - Protection against code injection and infinite loops

- **Enhanced Validation Service** (`EnhancedValidationService`):

  - URL and hostname validation with SSRF protection
  - HTTP configuration validation
  - Port and security validation
  - Private IP range detection and blocking

- **General Validation Service** (Zod-based):

  - Schema-based input validation
  - Type-safe data transformation
  - Structured error handling

- **Script Validation API** (`/api/validate-script`):
  - Pre-execution endpoint for client-side validation
  - Real-time feedback during script editing
  - Integration with playground UI for immediate validation

### 6. Redis Memory Management

The system includes a sophisticated Redis memory management strategy to prevent unbounded memory growth:

- **Key TTL (Time-To-Live) Settings**:

  - **Job Data (7 days)**: Completed and failed jobs are retained for analysis
  - **Event Streams (24 hours)**: Real-time status updates expire after a day
  - **Metrics Data (48 hours)**: Performance metrics are kept for two days

- **Automated Cleanup Mechanisms**:

  - **Job Cleanup**: Regular cleaning of completed/failed jobs older than TTL
  - **Event Stream Trimming**: Event streams capped at 1000 events
  - **Orphaned Key Detection**: Background workers scan for keys without TTL and add expiration

- **Memory Optimization Techniques**:

  - **Batched Processing**: Keys are processed in small batches (100 at a time)
  - **Efficient Key Scanning**: Uses Redis SCAN instead of KEYS to reduce memory pressure
  - **Reduced Storage Limits**: Lower limits for completed jobs (500) and failed jobs (1000)
  - **Frequent Cleanup**: Cleanup operations run every 12 hours

- **BullMQ Configuration**:

  - Queue configuration follows NestJS BullMQ best practices
  - Default job options set job removal limits (500 completed/1000 failed jobs)
  - Worker processors implement proper stalled job handling
  - Implementation across both client and server for consistent memory management

- **Benefits**:
  - Predictable memory usage over time
  - Automatic recovery from memory leaks
  - Protection against Redis out-of-memory conditions
  - Consistent performance regardless of system uptime

## Error Handling and Recovery

The system implements several error handling mechanisms:

1. **Queue-Level Retries**:

   - BullMQ automatically retries failed jobs with backoff
   - Maximum retry attempts are configurable

2. **Execution Timeouts**:

   - Tests are terminated if they exceed the configured timeout
   - Default timeout is 15 minutes (configurable)

3. **Worker Crash Recovery**:

   - Jobs are marked as "stalled" if workers crash
   - BullMQ automatically reprocesses stalled jobs

4. **Report Fallbacks**:

   - If S3 upload fails, local report access is attempted
   - Error reports are still generated for failed tests

5. **UI Error Handling**:
   - ReportViewer shows user-friendly error messages
   - Provides retry options and troubleshooting information

## Playground Cleanup System

### Background Process Integration

The playground cleanup system operates as a separate background process that integrates seamlessly with the existing job execution architecture:

**Process Characteristics:**

- **Independence**: Operates independently from test execution workflows
- **Multi-Instance Safe**: Uses Redis coordination to prevent duplicate cleanup across multiple app instances
- **Configurable**: Environment-driven scheduling and retention policies
- **Robust**: Comprehensive error handling and retry logic

**Integration Points:**

- **Initialization**: Starts after job schedulers during app startup sequence
- **Redis Connection**: Leverages existing Redis connection pool from queue management
- **S3 Service**: Reuses existing S3 cleanup service for consistency and reliability
- **Monitoring**: Provides status and manual trigger endpoints for administrative control

**Batch Processing Architecture:**

- **Memory Optimization**: Processes 1000 S3 objects per batch to prevent memory overflow
- **API Efficiency**: Aligns with AWS S3 DeleteObjects API limit (1000 objects max per request)
- **Progress Tracking**: Logs progress every batch for operational visibility
- **Interrupt Recovery**: Failure recovery limited to current batch, not entire operation

## Configuration Options

The test execution system can be configured via environment variables:

```bash
# Database
DATABASE_URL=postgres://user:password@${DB_HOST}:5432/supercheck

# Redis (for queue)
REDIS_URL=redis://${REDIS_HOST}:6379

# S3/MinIO
S3_ENDPOINT=http://${S3_HOST}:9000
S3_JOB_BUCKET_NAME=playwright-job-artifacts
S3_TEST_BUCKET_NAME=playwright-test-artifacts
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin

# Execution Parameters
RUNNING_CAPACITY=5                 # Maximum concurrent executions allowed to run
QUEUED_CAPACITY=50                 # Maximum executions allowed in queued state
TEST_EXECUTION_TIMEOUT_MS=900000   # 15 minutes default

# Playground Cleanup Parameters
PLAYGROUND_CLEANUP_ENABLED=true           # Enable/disable playground cleanup
PLAYGROUND_CLEANUP_CRON=0 */12 * * *      # Cron schedule (default: every 12 hours)
PLAYGROUND_CLEANUP_MAX_AGE_HOURS=24       # Delete reports older than 24 hours
```

## Start Services Quick Reference

```bash
# Start Redis
docker run -d --name redis-supercheck -p 6379:6379 redis

# Start Postgres
docker run -d --name postgres-supercheck -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=supercheck -p 5432:5432 postgres:18

# Start MinIO
docker run -d --name minio-supercheck -p 9000:9000 -p 9001:9001 -e "MINIO_ROOT_USER=minioadmin" -e "MINIO_ROOT_PASSWORD=minioadmin" minio/minio server /data --console-address ":9001"
```

## Implementation Details

### Queue Configuration

The system uses BullMQ with the following configuration:

```typescript
// Default job options with TTL settings (consistent across app and worker)
const defaultJobOptions = {
  removeOnComplete: { count: 500, age: 24 * 3600 }, // Keep completed jobs for 24 hours (500 max)
  removeOnFail: { count: 1000, age: 7 * 24 * 3600 }, // Keep failed jobs for 7 days (1000 max)
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
};

// Queue settings with Redis TTL and auto-cleanup options
const queueSettings = {
  connection,
  defaultJobOptions,
  stalledInterval: 30000, // Check for stalled jobs every 30 seconds
  metrics: {
    maxDataPoints: 60, // Limit metrics storage to 60 data points
    collectDurations: true,
  },
};

// Redis connection configuration (consistent across app and worker)
const redisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  username: process.env.REDIS_USERNAME,
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false, // Avoid ready check for client connection
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 100, 3000); // Exponential backoff capped at 3s
    return delay;
  },
  tls: process.env.REDIS_TLS_ENABLED === 'true' ? {
    rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false',
  } : undefined,
};
```

### SSE Implementation

Server-Sent Events are implemented for real-time status updates:

```typescript
// SSE endpoint for test status
export async function GET(request: Request) {
  const stream = new ReadableStream({
    async start(controller) {
      // Set up polling to check test status from Bull queue
      const pollInterval = setInterval(async () => {
        // Get job state and send updates
        const state = await updatedTestJob.getState();
        controller.enqueue(
          encoder.encode(
            createSSEMessage({
              status,
              testId,
              progress,
              reportPath: updatedReport?.reportPath,
              s3Url: updatedReport?.s3Url,
            })
          )
        );
      }, 1000); // Poll every second
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

### Capacity Management

The system implements sophisticated capacity management through environment-configurable limits:

```typescript
// Capacity limits from worker/src/execution/constants.ts and app/src/lib/queue-stats.ts
export const RUNNING_CAPACITY = parseInt(process.env.RUNNING_CAPACITY || "5");
export const QUEUED_CAPACITY = parseInt(process.env.QUEUED_CAPACITY || "50");

// Real-time queue statistics from app/src/lib/queue-stats.ts
export async function fetchQueueStats(): Promise<QueueStats> {
  // Counts active jobs from BullMQ Redis keys
  const runningCount =
    activeJobs + activeTests + processingJobs + processingTests;
  const queuedCount = waitingJobs + waitingTests + delayedJobs + delayedTests;

  return {
    running: Math.min(runningCount, RUNNING_CAPACITY),
    runningCapacity: RUNNING_CAPACITY,
    queued: queuedCount,
    queuedCapacity: QUEUED_CAPACITY,
  };
}

// Capacity verification before job submission
export async function verifyQueueCapacityOrThrow(): Promise<void> {
  const stats = await fetchQueueStats();

  if (stats.running >= stats.runningCapacity) {
    if (stats.queued >= stats.queuedCapacity) {
      throw new Error(
        `Queue capacity limit reached (${stats.queued}/${stats.queuedCapacity} queued jobs).`
      );
    }
  }
}
```

This comprehensive system ensures reliable, scalable, and observable test execution with proper resource management and real-time feedback. The capacity management system uses RUNNING_CAPACITY and QUEUED_CAPACITY environment variables to control system load, with sophisticated Redis-based queue statistics tracking for accurate capacity enforcement across distributed workers.
