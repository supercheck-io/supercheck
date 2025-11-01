# Supercheck K6 Performance Testing - Final Implementation Plan

**Version:** 1.0 Final
**Status:** Ready for Implementation
**Approach:** Single Queue + Worker Location Filtering

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Location Strategy (Single Queue + Filtering)](#location-strategy)
4. [Data Model](#data-model)
5. [Frontend Implementation](#frontend-implementation)
6. [Backend API](#backend-api)
7. [Worker Implementation](#worker-implementation)
8. [k6 Best Practices](#k6-best-practices)
9. [Rollout Plan](#rollout-plan)
10. [Testing Strategy](#testing-strategy)

---

## Executive Summary

A **simple, production-ready** implementation to integrate k6 performance testing into Supercheck, following k6 best practices and reusing proven Playwright execution patterns.

### Core Features

✅ **Performance Test** type (5th test type alongside Browser, API, Database, Custom)
✅ **Single test execution** (run from playground with live console + report)
✅ **K6 Job** type (multiple performance tests in jobs)
✅ **Real-time console streaming** (raw k6 stdout via Redis + SSE)
✅ **k6 built-in web dashboard** (static HTML report in iframe)
✅ **Parallel execution** (2-3 concurrent k6 tests, configurable)
✅ **Location-based execution** (single queue + worker filtering)
✅ **Dedicated S3 bucket** (supercheck-performance-artifacts)

### Design Principles

- **Simple:** No complex orchestration, no live metrics parsing
- **k6-Native:** Let k6 handle configuration, thresholds, reporting
- **Scalable:** Start with single worker, easily upgrade to multi-region
- **Consistent:** Mirrors Playwright execution patterns (both single test + job execution)

---

## Architecture Overview

### High-Level Flow

#### Flow 1: Single Test Execution (from Playground)

```
User creates Performance Test in Playground
         ↓
User clicks "Run" button (selects location)
         ↓
POST /api/tests/[id]/execute → Test execution created
         ↓
BullMQ enqueues to k6-execution queue
         ↓
Worker executes k6 binary
         ↓
Streams console → Redis → SSE → Playground "Report" tab
         ↓
Shows live console output (no loader!)
         ↓
k6 completes → HTML dashboard generated
         ↓
Report tab switches to iframe with HTML report
```

#### Flow 2: Job Execution (Multiple Tests)

```
User creates K6 Job (selects performance tests + location)
         ↓
User triggers job → Run created (status: pending)
         ↓
BullMQ enqueues to k6-execution queue (with location)
         ↓
Worker picks up job (filters by location match)
         ↓
K6ExecutionService executes k6 binary
         ↓
Streams raw console output → Redis → SSE → Frontend
         ↓
k6 completes → Generates HTML dashboard
         ↓
Upload to S3 → Update run status (passed/failed)
         ↓
User views: Console logs + HTML report in iframe
```

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Next.js App (Frontend)                                     │
│  • Performance Test type (script editor)                    │
│  • K6 Job type (job form with location selector)            │
│  • Console stream viewer (real-time)                        │
│  • HTML report viewer (iframe)                              │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP/SSE
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  API Routes (Next.js)                                       │
│  • POST /api/tests (create performance test)                │
│  • POST /api/jobs (create k6 job)                           │
│  • POST /api/runs (trigger run with location)               │
│  • GET /api/runs/[id]/stream (SSE console stream)           │
└────────────────────┬────────────────────────────────────────┘
                     │ Redis
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  BullMQ Queue                                               │
│  • k6-execution (single queue)                              │
│  • Job payload includes location                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Worker (NestJS) - Can deploy multiple instances            │
│                                                              │
│  Configuration:                                              │
│  • WORKER_LOCATION=us-east (or eu-central, asia-pacific)    │
│  • ENABLE_LOCATION_FILTERING=true/false                     │
│  • K6_MAX_CONCURRENCY=3                                     │
│                                                              │
│  Processor Logic:                                            │
│  • Picks job from queue                                     │
│  • If FILTERING enabled: check job.location === WORKER_LOC  │
│  • If match (or filtering disabled): process                │
│  • If no match: skip (another worker will pick it up)       │
│                                                              │
│  Services:                                                   │
│  • K6ExecutionService (executes k6 binary)                  │
│  • K6ExecutionProcessor (queue consumer)                    │
│  • RedisService (console streaming)                         │
│  • S3Service (artifact upload)                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  S3 Storage                                                 │
│  • supercheck-performance-artifacts/                        │
│    {orgId}/{projectId}/runs/{runId}/                       │
│      ├── index.html (k6 web dashboard)                      │
│      ├── summary.json (metrics JSON)                        │
│      └── console.log (full output)                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Location Strategy

### Single Queue + Worker Filtering

**Approach:** One BullMQ queue, workers filter jobs based on location

### Two Deployment Modes

#### Mode 1: Single Worker (MVP)

**Configuration:**
```bash
WORKER_LOCATION=us-east
ENABLE_LOCATION_FILTERING=false  # Process ALL jobs regardless of location
K6_MAX_CONCURRENCY=3
```

**Behavior:**
- Location captured on the `runs.location` column but not enforced
- Worker processes all k6 jobs
- Results tagged with `location: "us-east"` (or whatever user selected)
- **Use Case:** MVP, get k6 working quickly

#### Mode 2: Multi-Region Workers (Production)

**US East Worker:**
```bash
WORKER_LOCATION=us-east
ENABLE_LOCATION_FILTERING=true  # Only process jobs with location=us-east
K6_MAX_CONCURRENCY=3
```

**EU Central Worker:**
```bash
WORKER_LOCATION=eu-central
ENABLE_LOCATION_FILTERING=true  # Only process jobs with location=eu-central
K6_MAX_CONCURRENCY=3
```

**Asia Pacific Worker:**
```bash
WORKER_LOCATION=asia-pacific
ENABLE_LOCATION_FILTERING=true  # Only process jobs with location=asia-pacific
K6_MAX_CONCURRENCY=3
```

**Behavior:**
- Each worker only processes jobs matching its location
- Jobs with `location: "eu-central"` are skipped by US East worker
- **True geo-distributed execution**
- **Use Case:** Production, multi-region load testing

### Worker Processing Logic

```typescript
async process(job: Job<K6ExecutionTask>): Promise<void> {
  const { location } = job.data;
  const jobLocation = location || 'us-east'; // Default

  // Location filtering (if enabled)
  if (this.enableLocationFiltering && jobLocation !== this.workerLocation) {
    // Skip this job - wrong location
    this.logger.debug(`Skipping job ${job.id} - location mismatch`);
    return; // Another worker in correct region will process it
  }

  // Process job
  this.logger.log(`Processing k6 test from ${this.workerLocation}`);
  await this.k6ExecutionService.runK6Test(job.data);
}
```

### Migration Path

```
1. Start → Deploy single worker
           ENABLE_LOCATION_FILTERING=false
           Location stored on runs but not enforced

2. Upgrade → Deploy workers in us-east, eu-central, asia-pacific
           → Set ENABLE_LOCATION_FILTERING=true on all workers
           → Each worker processes only its location jobs
           → True geo-distributed execution achieved!
```

---

## Data Model

### Type Definitions

**File:** `app/src/db/schema/types.ts`

```typescript
// Add 'performance' to TestType
export type TestType = "browser" | "api" | "database" | "custom" | "performance";

// Add K6 job type
export type JobType = "playwright" | "k6";

// Location enum
export type K6Location = "us-east" | "eu-central" | "asia-pacific";

// Update ReportType
export type ReportType = "test" | "job" | "monitor" | "k6_performance";
```

### Database Schema

#### Runs Table Enhancements (shared execution tracking)

```sql
ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS report_s3_url TEXT,
  ADD COLUMN IF NOT EXISTS logs_s3_url TEXT,
  ADD COLUMN IF NOT EXISTS video_s3_url TEXT,
  ADD COLUMN IF NOT EXISTS screenshots_s3_path TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

-- Ensure commonly filtered columns stay fast
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
```

- Reuse the existing `runs` table for both Playwright and k6 executions.
- Store k6-specific context (e.g., `location`, thresholds) inside `runs.metadata`.
- Keep large artifacts (reports, logs, videos) in S3 and reference them via the new URL/path columns.

#### New Table: `k6_performance_runs`

```sql
CREATE TABLE IF NOT EXISTS k6_performance_runs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relationships
  test_id VARCHAR REFERENCES tests(id) ON DELETE CASCADE,
  job_id VARCHAR REFERENCES jobs(id) ON DELETE CASCADE,
  run_id VARCHAR NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  organization_id VARCHAR NOT NULL REFERENCES organizations(id),
  project_id VARCHAR NOT NULL REFERENCES projects(id),

  -- Execution location (where test actually ran)
  location VARCHAR(50) DEFAULT 'us-east',

  -- Status tracking
  status VARCHAR(20) NOT NULL, -- 'running' | 'passed' | 'failed' | 'error'
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  duration_ms INTEGER,

  -- Results (from summary.json)
  summary_json JSONB, -- Full k6 summary output
  thresholds_passed BOOLEAN,

  -- Quick access metrics (extracted from summary)
  total_requests INTEGER,
  failed_requests INTEGER,
  request_rate INTEGER,          -- Store as requests/sec * 100 for precision
  avg_response_time_ms INTEGER,
  p95_response_time_ms INTEGER,
  p99_response_time_ms INTEGER,

  -- Artifacts
  report_s3_url TEXT,
  summary_s3_url TEXT,
  console_s3_url TEXT,

  -- Error tracking
  error_details TEXT,
  console_output TEXT, -- Truncated for quick view (full in S3)

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Indexes
  INDEX idx_k6_runs_test_id (test_id),
  INDEX idx_k6_runs_job_id (job_id),
  INDEX idx_k6_runs_run_id (run_id),
  INDEX idx_k6_runs_status (status),
  INDEX idx_k6_runs_location (location),
  INDEX idx_k6_runs_created (created_at DESC)
);
```

#### Update Existing Tables

```sql
-- Update tests table
ALTER TABLE tests
  MODIFY COLUMN type VARCHAR(20) CHECK (type IN ('browser', 'api', 'database', 'custom', 'performance'));

-- Update jobs table
ALTER TABLE jobs
  ADD COLUMN job_type VARCHAR(20) DEFAULT 'playwright' CHECK (job_type IN ('playwright', 'k6'));

-- Update runs table
ALTER TABLE runs
  ADD COLUMN report_s3_url TEXT,
  ADD COLUMN logs_s3_url TEXT,
  ADD COLUMN video_s3_url TEXT,
  ADD COLUMN screenshots_s3_path TEXT,
  ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN location VARCHAR(50);

-- Update reports table
ALTER TABLE reports
  MODIFY COLUMN report_type VARCHAR(20) CHECK (report_type IN ('test', 'job', 'monitor', 'k6_performance'));
```

### Drizzle Schema

**File:** `app/src/db/schema/k6_runs.ts`

```typescript
import { pgTable, varchar, timestamp, jsonb, integer, boolean, text } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { tests } from './tests';
import { jobs } from './jobs';
import { runs } from './runs';

export const k6PerformanceRuns = pgTable('k6_performance_runs', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),

  testId: varchar('test_id').references(() => tests.id, { onDelete: 'cascade' }),
  jobId: varchar('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
  runId: varchar('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  organizationId: varchar('organization_id').notNull(),
  projectId: varchar('project_id').notNull(),

  location: varchar('location', { length: 50 }).default('us-east'),

  status: varchar('status', { length: 20 }).notNull(),
  startedAt: timestamp('started_at').defaultNow(),
  completedAt: timestamp('completed_at'),
  durationMs: integer('duration_ms'),

  summaryJson: jsonb('summary_json'),
  thresholdsPassed: boolean('thresholds_passed'),

  totalRequests: integer('total_requests'),
  failedRequests: integer('failed_requests'),
  requestRate: integer('request_rate'), // stored as req/sec * 100
  avgResponseTimeMs: integer('avg_response_time_ms'),
  p95ResponseTimeMs: integer('p95_response_time_ms'),
  p99ResponseTimeMs: integer('p99_response_time_ms'),

  reportS3Url: text('report_s3_url'),
  summaryS3Url: text('summary_s3_url'),
  consoleS3Url: text('console_s3_url'),

  errorDetails: text('error_details'),
  consoleOutput: text('console_output'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const k6PerformanceRunsRelations = relations(k6PerformanceRuns, ({ one }) => ({
  test: one(tests, { fields: [k6PerformanceRuns.testId], references: [tests.id] }),
  job: one(jobs, { fields: [k6PerformanceRuns.jobId], references: [jobs.id] }),
  run: one(runs, { fields: [k6PerformanceRuns.runId], references: [runs.id] }),
}));

export const k6PerformanceRunInsertSchema = createInsertSchema(k6PerformanceRuns);
export const k6PerformanceRunSelectSchema = createSelectSchema(k6PerformanceRuns);

export type K6PerformanceRun = z.infer<typeof k6PerformanceRunSelectSchema>;
export type K6PerformanceRunInsert = z.infer<typeof k6PerformanceRunInsertSchema>;
```

---

## Frontend Implementation

### 1. Add Performance Test Type to Sidebar

**File:** `app/src/components/app-sidebar.tsx`

```typescript
const data = {
  Automate: [
    {
      title: "Create",
      url: "#",
      icon: SquarePlus,
      items: [
        {
          title: "Browser Test",
          url: "/playground?scriptType=browser",
          icon: Chrome,
          color: "!text-sky-600",
        },
        {
          title: "API Test",
          url: "/playground?scriptType=api",
          icon: ArrowLeftRight,
          color: "!text-teal-600",
        },
        {
          title: "Database Test",
          url: "/playground?scriptType=database",
          icon: Database,
          color: "!text-cyan-600",
        },
        {
          title: "Custom Test",
          url: "/playground?scriptType=custom",
          icon: SquareFunction,
          color: "!text-blue-600",
        },
        // NEW: Performance Test
        {
          title: "Performance Test",
          url: "/playground?scriptType=performance",
          icon: Zap,
          color: "!text-purple-600",
        },
      ],
    },
    // ... rest of Automate section
  ],
};
```

### 2. Playground - k6 Script Template & Execution

**File:** `app/src/app/(dashboard)/playground/page.tsx`

```typescript
'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function PlaygroundPage() {
  const searchParams = useSearchParams();
  const scriptType = searchParams.get('scriptType') || 'browser';
  const [activeTab, setActiveTab] = useState<'editor' | 'report'>('editor');
  const [isRunning, setIsRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);

  const getScriptTemplate = (scriptType: string) => {
    if (scriptType === 'performance') {
      return `import http from 'k6/http';
import { check, sleep } from 'k6';

// Test configuration - all settings in script
export const options = {
  vus: 10,              // 10 virtual users
  duration: '30s',      // Run for 30 seconds

  // Pass/fail criteria
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests < 500ms
    http_req_failed: ['rate<0.1'],     // Error rate < 10%
  },
};

export default function() {
  // Test logic
  const response = http.get('https://test-api.k6.io/public/crocodiles/');

  // Validation checks
  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}`;
    }

    // ... other script types
  };

  const handleRun = async () => {
    setIsRunning(true);
    setActiveTab('report');

    // For performance tests, show location selector first
    if (scriptType === 'performance') {
      // Show location selection dialog
      const location = await showLocationDialog();

      const response = await fetch(`/api/tests/${testId}/execute`, {
        method: 'POST',
        body: JSON.stringify({ location }),
      });

      const { runId } = await response.json();
      setRunId(runId);
    } else {
      // Playwright execution (existing flow)
      // ...
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="editor">Editor</TabsTrigger>
            <TabsTrigger value="report">Report</TabsTrigger>
          </TabsList>
        </Tabs>

        <Button onClick={handleRun} disabled={isRunning}>
          <Play className="h-4 w-4 mr-2" />
          Run
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1">
        {activeTab === 'editor' && (
          <CodeEditor
            value={script}
            onChange={setScript}
            language={scriptType === 'performance' ? 'javascript' : 'typescript'}
          />
        )}

        {activeTab === 'report' && (
          <div className="h-full">
            {isRunning && scriptType === 'performance' && runId ? (
              // Live console for performance tests
              <PerformanceTestReport runId={runId} />
            ) : isRunning ? (
              // Loader for Playwright tests
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Run your test to see the report
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Performance Test Report Component (Live Console → HTML Report):**

```typescript
// File: app/src/components/playground/performance-test-report.tsx

'use client';

import { useEffect, useState } from 'react';
import { ConsoleStream } from '@/components/runs/console-stream';

export function PerformanceTestReport({ runId }: { runId: string }) {
  const [status, setStatus] = useState<'running' | 'completed' | 'failed'>('running');
  const [reportUrl, setReportUrl] = useState<string | null>(null);

  useEffect(() => {
    // Poll for execution status
    const interval = setInterval(async () => {
      const response = await fetch(`/api/runs/${runId}`);
      const data = await response.json();

      setStatus(data.status);

      if (data.status === 'completed') {
        setReportUrl(data.reportUrl || data.reportS3Url || null);
        clearInterval(interval);
      } else if (data.status === 'failed') {
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [runId]);

  return (
    <div className="h-full flex flex-col">
      {/* Status Header */}
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status === 'running' && (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              <span className="font-medium">Running performance test...</span>
            </>
          )}
          {status === 'completed' && (
            <>
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="font-medium">Test completed</span>
            </>
          )}
          {status === 'failed' && (
            <>
              <XCircle className="h-4 w-4 text-red-600" />
              <span className="font-medium">Test failed</span>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {status === 'running' && (
          // Live console output
          <div className="h-full p-4">
            <h3 className="text-lg font-semibold mb-4">Live Console Output</h3>
            <ConsoleStream runId={runId} />
          </div>
        )}

        {status === 'completed' && reportUrl && (
          // HTML report in iframe
          <iframe
            src={reportUrl}
            className="w-full h-full border-0"
            title="k6 Performance Report"
          />
        )}

        {status === 'failed' && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <XCircle className="h-16 w-16 text-red-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Test Execution Failed</h3>
              <p className="text-muted-foreground">Check the console output for details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Location Selection Dialog:**

```typescript
// File: app/src/components/playground/location-dialog.tsx

export function LocationSelectionDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (location: string) => void;
}) {
  const [selectedLocation, setSelectedLocation] = useState('us-east');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Select Execution Location</DialogTitle>
          <DialogDescription>
            Choose the geographical region where this performance test will execute
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <RadioGroup value={selectedLocation} onValueChange={setSelectedLocation}>
            <div className="flex items-center space-x-2 p-3 border rounded hover:bg-accent cursor-pointer">
              <RadioGroupItem value="us-east" id="us-east" />
              <Label htmlFor="us-east" className="flex-1 cursor-pointer">
                <div className="font-medium">US East (Virginia)</div>
                <div className="text-sm text-muted-foreground">North America</div>
              </Label>
            </div>

            <div className="flex items-center space-x-2 p-3 border rounded hover:bg-accent cursor-pointer">
              <RadioGroupItem value="eu-central" id="eu-central" />
              <Label htmlFor="eu-central" className="flex-1 cursor-pointer">
                <div className="font-medium">EU Central (Frankfurt)</div>
                <div className="text-sm text-muted-foreground">Europe</div>
              </Label>
            </div>

            <div className="flex items-center space-x-2 p-3 border rounded hover:bg-accent cursor-pointer">
              <RadioGroupItem value="asia-pacific" id="asia-pacific" />
              <Label htmlFor="asia-pacific" className="flex-1 cursor-pointer">
                <div className="font-medium">Asia Pacific (Singapore)</div>
                <div className="text-sm text-muted-foreground">Asia</div>
              </Label>
            </div>
          </RadioGroup>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => {
            onSelect(selectedLocation);
            onOpenChange(false);
          }}>
            Run Test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 3. k6 Script Validation

**File:** `app/src/lib/k6-validator.ts`

```typescript
export function validateK6Script(script: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Must have k6 imports
  if (!/import.*from\s+['"]k6/.test(script)) {
    errors.push('Script must import from k6 modules (e.g., import http from "k6/http")');
  }

  // Must have default export function
  if (!/export\s+default\s+function/.test(script)) {
    errors.push('Script must export a default function');
  }

  // Recommend options export
  if (!/export\s+const\s+options\s*=/.test(script)) {
    errors.push('Consider adding "export const options" to configure VUs, duration, and thresholds');
  }

  // Block Node.js modules (k6 doesn't support them)
  const forbiddenModules = ['fs', 'path', 'child_process', 'net', 'http', 'https', 'crypto', 'os'];
  forbiddenModules.forEach(mod => {
    if (new RegExp(`require\\(['"]${mod}['"]\\)|import.*from\\s+['"]${mod}['"]`).test(script)) {
      errors.push(`k6 does not support Node.js module "${mod}". Use k6 built-in modules instead.`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
```

### 4. Test Form Updates (Hide Incompatible Fields)

**File:** `app/src/components/tests/test-form.tsx`

```typescript
'use client';

import { useSearchParams } from 'next/navigation';

export function TestForm() {
  const searchParams = useSearchParams();
  const testType = searchParams.get('type') || form.watch('type');
  const isPerformanceTest = testType === 'performance';

  return (
    <Form {...form}>
      {/* Title */}
      <FormField name="title" />

      {/* Description */}
      <FormField name="description" />

      {/* Type - Don't show dropdown if performance test */}
      {!isPerformanceTest && (
        <FormField
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Test Type</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="browser">Browser Test</SelectItem>
                  <SelectItem value="api">API Test</SelectItem>
                  <SelectItem value="database">Database Test</SelectItem>
                  <SelectItem value="custom">Custom Test</SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
      )}

      {/* Priority - Hide for performance tests */}
      {!isPerformanceTest && (
        <FormField name="priority" />
      )}

      {/* Tags */}
      <FormField name="tags" />

      {/* Note: Performance tests don't need priority or browser selection */}
      {/* Everything is configured in the k6 script itself */}
    </Form>
  );
}
```

### 5. Job Form with Location Selector

**File:** `app/src/components/jobs/job-form.tsx`

```typescript
export function JobForm() {
  const [jobType, setJobType] = useState<'playwright' | 'k6'>('playwright');
  const [location, setLocation] = useState<'us-east' | 'eu-central' | 'asia-pacific'>('us-east');

  // Filter tests by compatibility
  const compatibleTests = useMemo(() => {
    return tests.filter(test => {
      if (jobType === 'playwright') {
        return ['browser', 'api', 'database', 'custom'].includes(test.type);
      } else {
        return test.type === 'performance';
      }
    });
  }, [tests, jobType]);

  return (
    <Form {...form}>
      {/* Job Type Selection */}
      <FormField
        control={form.control}
        name="jobType"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Job Type</FormLabel>
            <Select onValueChange={(value) => {
              setJobType(value as 'playwright' | 'k6');
              form.setValue('testIds', []); // Clear incompatible tests
              field.onChange(value);
            }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="playwright">
                  <div className="flex items-center gap-2">
                    <PlaywrightLogo className="h-4 w-4" />
                    Playwright Job
                  </div>
                </SelectItem>
                <SelectItem value="k6">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    K6 Performance Job
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <FormDescription>
              {jobType === 'playwright'
                ? 'Run browser, API, database, and custom tests'
                : 'Run performance and load tests with k6'}
            </FormDescription>
          </FormItem>
        )}
      />

      {/* Location Selector (K6 jobs only) */}
      {jobType === 'k6' && (
        <FormField
          control={form.control}
          name="location"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Execution Location</FormLabel>
              <Select onValueChange={field.onChange} defaultValue="us-east">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="us-east">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      <div>
                        <div className="font-medium">US East (Virginia)</div>
                        <div className="text-xs text-muted-foreground">North America</div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="eu-central">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      <div>
                        <div className="font-medium">EU Central (Frankfurt)</div>
                        <div className="text-xs text-muted-foreground">Europe</div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="asia-pacific">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      <div>
                        <div className="font-medium">Asia Pacific (Singapore)</div>
                        <div className="text-xs text-muted-foreground">Asia</div>
                      </div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                Select the geographical region where this test will execute
              </FormDescription>
            </FormItem>
          )}
        />
      )}

      {/* Test Selection */}
      <FormField
        control={form.control}
        name="testIds"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Select {jobType === 'k6' ? 'Performance' : 'Playwright'} Tests
              <span className="ml-2 text-sm text-muted-foreground">
                ({compatibleTests.length} available)
              </span>
            </FormLabel>
            <TestMultiSelect
              tests={compatibleTests}
              value={field.value}
              onChange={field.onChange}
            />
          </FormItem>
        )}
      />
    </Form>
  );
}
```

### 5. Run Detail Page

**File:** `app/src/components/runs/run-detail-page.tsx`

```typescript
export function RunDetailPage({ runId }: { runId: string }) {
  const { data: run } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => fetch(`/api/runs/${runId}`).then(r => r.json()),
    refetchInterval: (data) => data?.status === 'running' ? 2000 : false,
  });

  const isK6Run = run?.job?.jobType === 'k6';
  const location = run?.k6Run?.location;
  const reportUrl = run?.reportUrl || run?.reportS3Url;

  return (
    <div className="space-y-6">
      {/* Header with Location Badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">{run?.job?.name}</h1>
          {location && (
            <Badge variant="secondary" className="text-sm">
              <MapPin className="h-3 w-3 mr-1" />
              {location === 'us-east' && 'US East'}
              {location === 'eu-central' && 'EU Central'}
              {location === 'asia-pacific' && 'Asia Pacific'}
            </Badge>
          )}
        </div>
        <RunStatusBadge status={run?.status} />
      </div>

      {/* Real-time Console (during execution) */}
      {run?.status === 'running' && (
        <Card>
          <CardHeader>
            <CardTitle>
              {isK6Run ? 'Performance Test Console' : 'Test Execution Console'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ConsoleStream runId={runId} />
          </CardContent>
        </Card>
      )}

      {/* HTML Report (after completion) */}
      {run?.status !== 'running' && reportUrl && (
        <Card>
          <CardHeader>
            <CardTitle>
              {isK6Run ? 'Performance Report' : 'Test Report'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <iframe
              src={reportUrl}
              className="w-full h-[800px] border rounded"
              title={isK6Run ? 'k6 Performance Report' : 'Test Report'}
            />
          </CardContent>
        </Card>
      )}

      {/* Metrics Summary (k6 only) */}
      {isK6Run && run?.k6Run?.summaryJson && (
        <Card>
          <CardHeader>
            <CardTitle>Metrics Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <K6MetricsGrid metrics={run.k6Run} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

### 6. Console Stream Component

**File:** `app/src/components/runs/console-stream.tsx`

```typescript
'use client';

import { useEffect, useRef, useState } from 'react';

export function ConsoleStream({ runId }: { runId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Server-Sent Events for real-time streaming
    const eventSource = new EventSource(`/api/runs/${runId}/stream`);

    eventSource.addEventListener('console', (e) => {
      const data = JSON.parse(e.data);
      setLines(prev => [...prev, data.line]);
    });

    eventSource.addEventListener('complete', () => {
      eventSource.close();
    });

    eventSource.addEventListener('error', (e) => {
      console.error('SSE error:', e);
      eventSource.close();
    });

    return () => {
      eventSource.close();
    };
  }, [runId]);

  // Auto-scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <div className="bg-black text-green-400 font-mono text-sm p-4 rounded h-96 overflow-auto">
      {lines.length === 0 && (
        <div className="text-gray-500">Waiting for output...</div>
      )}
      {lines.map((line, i) => (
        <div key={i} className="whitespace-pre-wrap">
          {line}
        </div>
      ))}
      <div ref={scrollRef} />
    </div>
  );
}
```

### 7. K6 Metrics Grid

**File:** `app/src/components/runs/k6-metrics-grid.tsx`

```typescript
export function K6MetricsGrid({ metrics }: { metrics: K6PerformanceRun }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      <MetricCard
        label="Total Requests"
        value={metrics.totalRequests?.toLocaleString() || 'N/A'}
        icon={Activity}
      />
      <MetricCard
        label="Failed Requests"
        value={metrics.failedRequests?.toLocaleString() || '0'}
        icon={AlertCircle}
        alert={metrics.failedRequests > 0}
      />
      <MetricCard
        label="Request Rate"
        value={`${metrics.requestRate?.toFixed(2) || 0} req/s`}
        icon={TrendingUp}
      />
      <MetricCard
        label="Avg Response Time"
        value={`${metrics.avgResponseTimeMs?.toFixed(0) || 0} ms`}
        icon={Clock}
      />
      <MetricCard
        label="P95 Response Time"
        value={`${metrics.p95ResponseTimeMs?.toFixed(0) || 0} ms`}
        icon={BarChart}
      />
      <MetricCard
        label="P99 Response Time"
        value={`${metrics.p99ResponseTimeMs?.toFixed(0) || 0} ms`}
        icon={BarChart}
      />
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, alert }: {
  label: string;
  value: string;
  icon: any;
  alert?: boolean;
}) {
  return (
    <div className={`p-4 border rounded ${alert ? 'border-red-500 bg-red-50' : ''}`}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className={`text-2xl font-bold ${alert ? 'text-red-600' : ''}`}>
        {value}
      </div>
    </div>
  );
}
```

---

## Backend API

### 1. Test API - Handle Performance Type

**File:** `app/src/app/api/tests/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { tests } from '@/db/schema';
import { validateK6Script } from '@/lib/k6-validator';

export async function POST(request: Request) {
  const body = await request.json();

  // Validate type
  const validTypes = ['browser', 'api', 'database', 'custom', 'performance'];
  if (!validTypes.includes(body.type)) {
    return NextResponse.json({ error: 'Invalid test type' }, { status: 400 });
  }

  // K6-specific validation
  if (body.type === 'performance') {
    const { valid, errors } = validateK6Script(body.script);
    if (!valid) {
      return NextResponse.json({
        error: 'Invalid k6 script',
        details: errors,
      }, { status: 400 });
    }
  }

  // Encode script
  const encodedScript = Buffer.from(body.script).toString('base64');

  // Create test
  const [test] = await db.insert(tests).values({
    ...body,
    script: encodedScript,
  }).returning();

  return NextResponse.json(test);
}
```

### 2. Single Test Execution API (Reuse Runs Table)

**File:** `app/src/app/api/tests/[id]/execute/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { Queue } from 'bullmq';
import { db } from '@/db';
import { tests, runs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

const k6Queue = new Queue('k6-execution', { connection: redisConnection });
const playwrightQueue = new Queue('playwright-execution', { connection: redisConnection });

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const testId = params.id;
  const { location = 'us-east' } = await request.json();

  // Fetch test
  const test = await db.query.tests.findFirst({
    where: eq(tests.id, testId),
  });

  if (!test) {
    return NextResponse.json({ error: 'Test not found' }, { status: 404 });
  }

  // Create run record (no job, tagged as playground)
  const [run] = await db.insert(runs).values({
    jobId: null,
    status: 'pending',
    trigger: 'manual',
    metadata: sql`jsonb_build_object(
      'source', 'playground',
      'testId', ${test.id},
      'location', ${location}
    )`,
  }).returning();

  // Enqueue based on test type
  if (test.type === 'performance') {
    const decodedScript = Buffer.from(test.script, 'base64').toString('utf8');

    await k6Queue.add('k6-single-test-execution', {
      runId: run.id,
      jobId: null,
      testId: test.id,
      script: decodedScript,
      tests: [
        {
          id: test.id,
          script: decodedScript,
        },
      ],
      organizationId: test.organizationId,
      projectId: test.projectId,
      location,
    });
  } else {
    await playwrightQueue.add('playwright-single-test-execution', {
      runId: run.id,
      testId: test.id,
      script: Buffer.from(test.script, 'base64').toString('utf8'),
    });
  }

  return NextResponse.json({
    runId: run.id,
    status: 'pending',
  });
}
```

### 3. Run Status API (Existing Endpoint)

Reuse the existing `GET /api/runs/[id]` handler to report status, artifact URLs, and k6 metrics. Ensure the response includes:

- `status`, `startedAt`, `completedAt`, `durationMs`
- `reportS3Url`, `logsS3Url`, `videoS3Url`, `screenshotsS3Path`
- `metadata` (e.g., `source`, `location`, `testId`)
- Nested `k6Run` data when a performance run is linked

### 2. Job API - Handle K6 Jobs

**File:** `app/src/app/api/jobs/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { jobs, tests } from '@/db/schema';
import { inArray, eq } from 'drizzle-orm';

export async function POST(request: Request) {
  const body = await request.json();
  const jobType = body.jobType || 'playwright';

  // Validate test compatibility
  if (body.testIds?.length > 0) {
    const selectedTests = await db.query.tests.findMany({
      where: inArray(tests.id, body.testIds),
    });

    // Check compatibility
    const incompatibleTests = selectedTests.filter(test => {
      if (jobType === 'playwright') {
        return test.type === 'performance';
      } else if (jobType === 'k6') {
        return test.type !== 'performance';
      }
      return false;
    });

    if (incompatibleTests.length > 0) {
      return NextResponse.json({
        error: `Job type "${jobType}" cannot include ${incompatibleTests.map(t => t.type).join(', ')} tests`,
        incompatibleTests: incompatibleTests.map(t => ({ id: t.id, type: t.type })),
      }, { status: 400 });
    }
  }

  // Create job
  const [job] = await db.insert(jobs).values({
    ...body,
    jobType,
  }).returning();

  return NextResponse.json(job);
}
```

### 3. Run Trigger API - Include Location

**File:** `app/src/app/api/runs/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { Queue } from 'bullmq';
import { db } from '@/db';
import { jobs, runs, tests } from '@/db/schema';
import { eq } from 'drizzle-orm';

const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

const k6Queue = new Queue('k6-execution', { connection: redisConnection });
const playwrightQueue = new Queue('playwright-execution', { connection: redisConnection });

export async function POST(request: Request) {
  const { jobId, trigger = 'manual', location = 'us-east' } = await request.json();

  // Fetch job with tests
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    with: { tests: true },
  });

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // Validate tests against job type (defensive guard)
  const hasIncompatibleTests = job.tests.some((test) =>
    job.jobType === 'k6'
      ? test.type !== 'performance'
      : test.type === 'performance'
  );

  if (hasIncompatibleTests) {
    return NextResponse.json(
      { error: `Job type "${job.jobType}" has incompatible tests attached` },
      { status: 409 }
    );
  }

  // Create run record
  const [run] = await db.insert(runs).values({
    jobId: job.id,
    status: 'pending',
    trigger,
    location: job.jobType === 'k6' ? location : null,
    metadata: {
      source: 'job',
      jobType: job.jobType,
    },
  }).returning();

  // Enqueue based on job type
  if (job.jobType === 'k6') {
    // Decode test scripts
    const testsWithScripts = await Promise.all(
      job.tests.map(async (test) => {
        const fullTest = await db.query.tests.findFirst({
          where: eq(tests.id, test.id),
        });

        return {
          ...test,
          script: Buffer.from(fullTest.script, 'base64').toString('utf8'),
        };
      })
    );

    if (testsWithScripts.length === 0) {
      return NextResponse.json(
        { error: 'k6 job must include at least one performance test' },
        { status: 400 }
      );
    }

    // Enqueue k6 execution with location
    const primaryTest = testsWithScripts[0];

    await k6Queue.add('k6-execution', {
      runId: run.id,
      jobId: job.id,
      testId: primaryTest.id,
      script: primaryTest.script,
      tests: testsWithScripts,
      organizationId: job.organizationId,
      projectId: job.projectId,
      location, // ← User-selected location
    });
  } else {
    // Enqueue Playwright execution
    await playwrightQueue.add('playwright-execution', {
      runId: run.id,
      jobId: job.id,
      tests: job.tests,
    });
  }

  return NextResponse.json(run);
}
```

### 4. Console Streaming API (SSE) - Updated for Both Runs and Executions

**File:** `app/src/app/api/runs/[id]/stream/route.ts`

```typescript
import { Redis } from 'ioredis';
import { db } from '@/db';
import { runs } from '@/db/schema';
import { eq } from 'drizzle-orm';

const redis = new Redis(process.env.REDIS_URL);

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const runId = params.id;

  // Verify run exists
  const run = await db.query.runs.findFirst({
    where: eq(runs.id, runId),
  });

  if (!run) {
    return new Response('Not Found', { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const subscriber = redis.duplicate();

      // Subscribe to console output channel
      subscriber.subscribe(`k6:run:${runId}:console`, (err) => {
        if (err) {
          controller.error(err);
          return;
        }
      });

      // Stream console messages
      subscriber.on('message', (channel, message) => {
        const data = `event: console\ndata: ${JSON.stringify({ line: message })}\n\n`;
        controller.enqueue(encoder.encode(data));
      });

      // Heartbeat every 30 seconds
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(': heartbeat\n\n'));
      }, 30000);

      // Check for completion every 2 seconds
      const completionCheck = setInterval(async () => {
        const currentRun = await db.query.runs.findFirst({
          where: eq(runs.id, runId),
        });

        if (currentRun && currentRun.status !== 'running') {
          const data = `event: complete\ndata: ${JSON.stringify({ status: currentRun.status })}\n\n`;
          controller.enqueue(encoder.encode(data));

          clearInterval(completionCheck);
          clearInterval(heartbeat);
          subscriber.unsubscribe();
          subscriber.quit();
          controller.close();
        }
      }, 2000);

      // Cleanup on abort
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        clearInterval(completionCheck);
        subscriber.unsubscribe();
        subscriber.quit();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

---

## Worker Implementation

### 1. K6 Execution Service

**File:** `worker/src/k6/services/k6-execution.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { S3Service } from '../../execution/services/s3.service';
import { DbService } from '../../db/db.service';
import { RedisService } from '../../execution/services/redis.service';

export interface K6ExecutionTask {
  runId: string;
  testId: string;
  organizationId: string;
  projectId: string;
  script: string; // Decoded k6 script
  jobId?: string | null;
  tests: Array<{ id: string; script: string }>;
  location?: string; // Execution location
}

export interface K6ExecutionResult {
  success: boolean;
  runId: string;
  durationMs: number;
  summary: any;
  thresholdsPassed: boolean;
  reportUrl: string | null;
  summaryUrl: string | null;
  consoleUrl: string | null;
  logsUrl: string | null;
  error: string | null;
}

@Injectable()
export class K6ExecutionService {
  private readonly logger = new Logger(K6ExecutionService.name);
  private readonly k6BinaryPath: string;
  private readonly baseLocalRunDir: string;
  private readonly maxConcurrentK6Runs: number;
  private activeK6Runs: Map<string, { pid: number; startTime: number }> = new Map();

  constructor(
    private configService: ConfigService,
    private s3Service: S3Service,
    private dbService: DbService,
    private redisService: RedisService,
  ) {
    this.k6BinaryPath = this.configService.get<string>('K6_BIN_PATH', '/usr/local/bin/k6');
    this.baseLocalRunDir = path.join(process.cwd(), 'k6-reports');
    this.maxConcurrentK6Runs = this.configService.get<number>('K6_MAX_CONCURRENCY', 3);

    this.logger.log(`K6 binary: ${this.k6BinaryPath}`);
    this.logger.log(`Max concurrent k6 runs: ${this.maxConcurrentK6Runs}`);
  }

  /**
   * Execute a k6 performance test
   */
  async runK6Test(task: K6ExecutionTask): Promise<K6ExecutionResult> {
    const { runId, testId, script, location } = task;
    const startTime = Date.now();

    // Check concurrency
    if (this.activeK6Runs.size >= this.maxConcurrentK6Runs) {
      throw new Error(`Max concurrent k6 runs reached: ${this.maxConcurrentK6Runs}`);
    }

    this.logger.log(
      `[${runId}] Starting k6 test${location ? ` (location: ${location})` : ''}`
    );

    const uniqueRunId = `${runId}-${crypto.randomUUID().substring(0, 8)}`;
    const runDir = path.join(this.baseLocalRunDir, uniqueRunId);

    let finalResult: K6ExecutionResult;

    try {
      // 1. Create directory
      await fs.mkdir(runDir, { recursive: true });

      // 2. Write script
      const scriptPath = path.join(runDir, 'test.js');
      await fs.writeFile(scriptPath, script);

      // 3. Build k6 command
      const reportPath = path.join(runDir, 'index.html');
      const summaryPath = path.join(runDir, 'summary.json');

      const args = [
        'run',
        '--out', `web-dashboard=${reportPath}`,      // k6 web dashboard
        '--summary-export', summaryPath,              // metrics JSON
        scriptPath,
      ];

      // 4. Execute k6 and stream output
      const execResult = await this.executeK6Binary(args, runDir, runId);

      // 5. Read summary
      let summary = null;
      try {
        const summaryContent = await fs.readFile(summaryPath, 'utf8');
        summary = JSON.parse(summaryContent);
      } catch (error) {
        this.logger.warn(`[${runId}] Failed to read summary.json: ${error.message}`);
      }

      // 6. Upload to S3
      const s3KeyPrefix = `${task.organizationId}/${task.projectId}/runs/${runId}`;
      const bucket = this.s3Service.getBucketForEntityType('k6_performance');

      await this.s3Service.uploadDirectory(runDir, s3KeyPrefix, bucket);

      const baseUrl = this.s3Service.getBaseUrlForEntity('k6_performance', runId);
      const reportUrl = `${baseUrl}/index.html`;
      const summaryUrl = `${baseUrl}/summary.json`;
      const consoleUrl = `${baseUrl}/console.log`;

      // 7. Determine pass/fail (k6 exit code)
      const thresholdsPassed = execResult.exitCode === 0;

      finalResult = {
        success: thresholdsPassed,
        runId,
        durationMs: Date.now() - startTime,
        summary,
        thresholdsPassed,
        reportUrl,
        summaryUrl,
        consoleUrl,
        logsUrl: consoleUrl,
        error: execResult.error,
      };

      this.logger.log(`[${runId}] k6 completed: ${thresholdsPassed ? 'PASSED' : 'FAILED'}`);

    } catch (error) {
      this.logger.error(`[${runId}] k6 failed: ${error.message}`, error.stack);

      finalResult = {
        success: false,
        runId,
        durationMs: Date.now() - startTime,
        summary: null,
        thresholdsPassed: false,
        reportUrl: null,
        summaryUrl: null,
        consoleUrl: null,
        logsUrl: null,
        error: error.message,
      };

      throw error;
    } finally {
      this.activeK6Runs.delete(uniqueRunId);

      // Cleanup
      try {
        await fs.rm(runDir, { recursive: true, force: true });
      } catch (cleanupError) {
        this.logger.warn(`[${runId}] Cleanup failed: ${cleanupError.message}`);
      }
    }

    return finalResult;
  }

  /**
   * Execute k6 binary and stream stdout
   */
  private async executeK6Binary(
    args: string[],
    cwd: string,
    runId: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string; error: string | null }> {
    return new Promise((resolve, reject) => {
      this.logger.log(`[${runId}] Executing: k6 ${args.join(' ')}`);

      const childProcess = spawn(this.k6BinaryPath, args, {
        cwd,
        env: {
          ...process.env,
          K6_NO_COLOR: '1', // Disable ANSI colors
        },
      });

      let stdout = '';
      let stderr = '';

      if (childProcess.pid) {
        this.activeK6Runs.set(runId, {
          pid: childProcess.pid,
          startTime: Date.now(),
        });
      }

      // Stream stdout to Redis (for real-time console)
      childProcess.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;

        // Publish to Redis for SSE
        this.redisService.publish(`k6:run:${runId}:console`, chunk).catch(err => {
          this.logger.warn(`Failed to publish console: ${err.message}`);
        });
      });

      childProcess.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
      });

      childProcess.on('close', (code) => {
        const exitCode = code || 0;

        this.logger.log(`[${runId}] k6 exited with code: ${exitCode}`);

        resolve({
          exitCode,
          stdout,
          stderr,
          error: exitCode !== 0 ? `k6 exited with code ${exitCode}` : null,
        });
      });

      childProcess.on('error', (error) => {
        this.logger.error(`[${runId}] k6 process error: ${error.message}`);
        reject(error);
      });
    });
  }
}
```

### 2. K6 Execution Processor (with Location Filtering)

**File:** `worker/src/k6/processors/k6-execution.processor.ts`

```typescript
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { sql } from 'drizzle-orm';
import { K6ExecutionService, K6ExecutionTask } from '../services/k6-execution.service';
import { DbService } from '../../db/db.service';
import * as schema from '../../db/schema';

type K6Task = K6ExecutionTask;

@Processor('k6-execution', {
  concurrency: 3, // Process up to 3 k6 tests in parallel
})
export class K6ExecutionProcessor extends WorkerHost {
  private readonly logger = new Logger(K6ExecutionProcessor.name);
  private readonly workerLocation: string;
  private readonly enableLocationFiltering: boolean;

  constructor(
    private k6ExecutionService: K6ExecutionService,
    private dbService: DbService,
    private configService: ConfigService,
  ) {
    super();

    // Worker location from environment
    this.workerLocation = this.configService.get<string>('WORKER_LOCATION', 'us-east');

    // Enable location filtering (false for MVP, true for multi-region)
    this.enableLocationFiltering = this.configService.get<boolean>(
      'ENABLE_LOCATION_FILTERING',
      false
    );

    if (this.enableLocationFiltering) {
      this.logger.log(
        `Worker location filtering ENABLED: ${this.workerLocation} (only processing jobs for this location)`
      );
    } else {
      this.logger.log(
        `Worker location filtering DISABLED: Processing all jobs (location still recorded for reporting)`
      );
    }
  }

  async process(job: Job<K6Task>): Promise<void> {
    const jobLocation = job.data.location || 'us-east'; // Default location
    const runId = job.data.runId;
    const isJobRun = Boolean(job.data.jobId);
    const testId = job.data.tests?.[0]?.id || job.data.testId;

    if (!testId) {
      throw new Error(`k6 task ${job.id} missing testId`);
    }

    // Location filtering (multi-region mode)
    if (this.enableLocationFiltering && jobLocation !== this.workerLocation) {
      // Skip this job - wrong location
      this.logger.debug(
        `[Job ${job.id}] Skipping - job location (${jobLocation}) doesn't match worker location (${this.workerLocation})`
      );
      // Important: Don't throw error, just return
      // Another worker in correct location will pick it up
      return;
    }

    this.logger.log(
      `[Job ${job.id}] Processing k6 ${isJobRun ? 'job' : 'single test'} from location: ${this.workerLocation}`
    );

    try {
      // Mark run as in-progress
      await this.dbService.db
        .update(schema.runs)
        .set({
          status: 'running',
          startedAt: new Date(),
          location: jobLocation,
        })
        .where(schema.eq(schema.runs.id, runId));

      // Execute k6
      const result = await this.k6ExecutionService.runK6Test(job.data);

      // Extract metrics from summary
      const metrics = this.extractMetrics(result.summary);

      // Create k6_performance_runs record
      const [k6Run] = await this.dbService.db
        .insert(schema.k6PerformanceRuns)
        .values({
          testId,
          runId,
          jobId: job.data.jobId ?? null,
          organizationId: job.data.organizationId,
          projectId: job.data.projectId,
          location: this.workerLocation, // Actual execution location
          status: result.success ? 'passed' : 'failed',
          startedAt: new Date(Date.now() - result.durationMs),
          completedAt: new Date(),
          durationMs: result.durationMs,
          summaryJson: result.summary,
          thresholdsPassed: result.thresholdsPassed,
          totalRequests: metrics.totalRequests,
          failedRequests: metrics.failedRequests,
          requestRate: Math.round((metrics.requestRate || 0) * 100),
          avgResponseTimeMs: metrics.avgResponseTimeMs,
          p95ResponseTimeMs: metrics.p95ResponseTimeMs,
          p99ResponseTimeMs: metrics.p99ResponseTimeMs,
          reportS3Url: result.reportUrl,
          summaryS3Url: result.summaryUrl ?? null,
          consoleS3Url: result.consoleUrl ?? null,
          errorDetails: result.error,
        })
        .returning();

      // Update run with final status and artifacts
      await this.dbService.db
        .update(schema.runs)
        .set({
          status: result.success ? 'passed' : 'failed',
          completedAt: new Date(),
          durationMs: result.durationMs,
          reportS3Url: result.reportUrl,
          logsS3Url: result.logsUrl ?? null,
          metadata: sql`
            jsonb_set(
              coalesce(metadata, '{}'::jsonb),
              '{k6RunId}',
              to_jsonb(${k6Run.id}::text),
              true
            )
          `,
        })
        .where(schema.eq(schema.runs.id, runId));

      this.logger.log(`[Job ${job.id}] Completed: ${result.success ? 'PASSED' : 'FAILED'}`);

    } catch (error) {
      this.logger.error(`[Job ${job.id}] Failed: ${error.message}`, error.stack);

      await this.dbService.db
        .update(schema.runs)
        .set({
          status: 'error',
          completedAt: new Date(),
          errorDetails: error.message,
        })
        .where(schema.eq(schema.runs.id, runId));

      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completed successfully`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`, error.stack);
  }

  /**
   * Extract key metrics from k6 summary for database storage
   */
  private extractMetrics(summary: any) {
    if (!summary?.metrics) return {};

    const metrics: any = {};

    // HTTP requests
    if (summary.metrics.http_reqs) {
      metrics.totalRequests = summary.metrics.http_reqs.values.count || 0;
      metrics.requestRate = summary.metrics.http_reqs.values.rate || 0;
    }

    // Failed requests
    if (summary.metrics.http_req_failed) {
      metrics.failedRequests = summary.metrics.http_req_failed.values.fails || 0;
    }

    // Response times
    if (summary.metrics.http_req_duration) {
      metrics.avgResponseTimeMs = summary.metrics.http_req_duration.values.avg || 0;
      metrics.p95ResponseTimeMs = summary.metrics.http_req_duration.values['p(95)'] || 0;
      metrics.p99ResponseTimeMs = summary.metrics.http_req_duration.values['p(99)'] || 0;
    }

    return metrics;
  }
}
```

### 3. S3 Service Update

**File:** `worker/src/execution/services/s3.service.ts` (Update)

```typescript
// Add k6 performance bucket
constructor(private configService: ConfigService) {
  this.jobBucketName = this.configService.get<string>(
    'S3_JOB_BUCKET_NAME',
    'playwright-job-artifacts',
  );
  this.testBucketName = this.configService.get<string>(
    'S3_TEST_BUCKET_NAME',
    'playwright-test-artifacts',
  );
  this.monitorBucketName = this.configService.get<string>(
    'S3_MONITOR_BUCKET_NAME',
    'playwright-monitor-artifacts',
  );
  // NEW: K6 performance bucket
  this.k6PerformanceBucketName = this.configService.get<string>(
    'S3_K6_PERFORMANCE_BUCKET_NAME',
    'supercheck-performance-artifacts',
  );

  // ... rest of constructor
}

async onModuleInit() {
  // Ensure all buckets exist
  await this.ensureBucketExists(this.jobBucketName);
  await this.ensureBucketExists(this.testBucketName);
  await this.ensureBucketExists(this.monitorBucketName);
  await this.ensureBucketExists(this.k6PerformanceBucketName); // NEW
}

getBucketForEntityType(entityType: string): string {
  if (entityType === 'test') {
    return this.testBucketName;
  }
  if (entityType === 'monitor') {
    return this.monitorBucketName;
  }
  if (entityType === 'k6_performance') { // NEW
    return this.k6PerformanceBucketName;
  }
  return this.jobBucketName; // Default
}
```

### 4. Worker Dockerfile

**File:** `worker/Dockerfile`

```dockerfile
FROM node:20-alpine AS base

# Install k6 (latest stable version)
RUN apk add --no-cache curl ca-certificates && \
    curl -L https://github.com/grafana/k6/releases/download/v0.49.0/k6-v0.49.0-linux-amd64.tar.gz | tar -xz && \
    mv k6-v0.49.0-linux-amd64/k6 /usr/local/bin/ && \
    rm -rf k6-v0.49.0-linux-amd64 && \
    chmod +x /usr/local/bin/k6

ENV K6_BIN_PATH=/usr/local/bin/k6

# Verify k6 installation
RUN k6 version

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

CMD ["node", "dist/main.js"]
```

### 5. Worker Environment Variables

**File:** `worker/.env.example`

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/supercheck

# Redis
REDIS_URL=redis://localhost:6379

# S3
S3_ENDPOINT=http://localhost:9000
S3_JOB_BUCKET_NAME=playwright-job-artifacts
S3_TEST_BUCKET_NAME=playwright-test-artifacts
S3_MONITOR_BUCKET_NAME=playwright-monitor-artifacts
S3_K6_PERFORMANCE_BUCKET_NAME=supercheck-performance-artifacts

# k6 Configuration
K6_BIN_PATH=/usr/local/bin/k6
K6_MAX_CONCURRENCY=3

# Worker Location
WORKER_LOCATION=us-east
ENABLE_LOCATION_FILTERING=false

# For multi-region setup, set ENABLE_LOCATION_FILTERING=true
# and deploy workers with different WORKER_LOCATION values
```

---

## k6 Best Practices

### 1. Script-Driven Configuration ✅

**All configuration in script:**

```javascript
export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.1'],
  },
};
```

**Why:** k6 is designed to be script-centric. Users control everything.

**Implementation:** Worker executes `k6 run script.js` with minimal CLI flags

### 2. Built-in Web Dashboard ✅

**Use k6's native HTML report:**

```bash
k6 run --out web-dashboard=report.html script.js
```

**Why:**
- Official k6 feature (stable)
- Standalone HTML with embedded charts
- Interactive visualizations
- No post-processing needed

### 3. Exit Code for Pass/Fail ✅

**k6 exit codes:**
- `0` = All thresholds passed
- `99` = Some thresholds failed
- `107` = Execution error

**Implementation:**

```typescript
const thresholdsPassed = execResult.exitCode === 0;
```

### 4. Parallel Execution (Limited) ✅

**Concurrency limits:**
- Small VM (2 CPU): 1-2 concurrent
- Medium VM (4 CPU): 2-3 concurrent
- Large VM (8+ CPU): 3-5 concurrent

**Why:** k6 is CPU/network intensive

**Configuration:**

```bash
K6_MAX_CONCURRENCY=3
```

### 5. Raw Console Streaming ✅

**Stream k6 stdout as-is:**

```
running (00m05s), 10/10 VUs, 150 complete iterations
     ✓ status is 200
     ✓ response time < 500ms
     checks............: 100.00% ✓ 5000
     http_req_duration.: avg=245ms p(95)=450ms
```

**Why:** k6's console output is already well-formatted

**Implementation:** Stream to Redis → SSE → Frontend (no parsing)

### 6. Summary Export for Metrics ✅

**Use `--summary-export=summary.json`:**

```bash
k6 run --summary-export=summary.json script.js
```

**Why:**
- Complete metrics in JSON
- Easy to parse and store
- No regex parsing needed

---

## Rollout Plan

### Phase 1: Foundation (Week 1)

**Backend:**
- [ ] Add `performance` to TestType enum
- [ ] Add `jobType` to jobs table (default: 'playwright')
- [ ] Backfill `runs` table with artifact/location columns
- [ ] Create `k6_performance_runs` table migration
- [ ] Install k6 in worker Dockerfile
- [ ] Add environment variables

**Frontend:**
- [ ] Add "Performance Test" to Create menu
- [ ] Add k6 script template to playground
- [ ] Implement k6 script validation
- [ ] Hide incompatible fields in test form for performance tests (NEW)

**Testing:**
- [ ] Verify k6 binary: `k6 version`
- [ ] Test script validation
- [ ] Test database migrations

### Phase 2: Single Test Execution (Week 2)

**Backend:**
- [ ] Enhance `/api/tests/[id]/execute` to create runs (reuse `runs` table)
- [ ] Ensure `/api/runs/[id]` includes k6 metrics/artifacts
- [ ] Implement `K6ExecutionService`
- [ ] Implement `K6ExecutionProcessor` (support both single test + job execution) (UPDATED)
- [ ] Set up `k6-execution` queue
- [ ] Configure S3 bucket for k6 artifacts
- [ ] Add Redis pub/sub for console streaming

**Frontend:**
- [ ] Add "Run" button to playground (NEW)
- [ ] Create location selection dialog for playground (NEW)
- [ ] Build `PerformanceTestReport` component with live console → HTML report (NEW)
- [ ] Update playground to show report tab instead of loader (NEW)

**Testing:**
- [ ] Unit test: K6ExecutionService
- [ ] Integration test: Single k6 test execution from playground (NEW)
- [ ] Verify HTML report generation
- [ ] Test location filtering logic
- [ ] Test live console streaming in playground (NEW)

### Phase 3: Job Integration (Week 3)

**Backend:**
- [ ] Update job creation API to handle k6 jobs
- [ ] Add job type validation (reject mismatched test types)
- [ ] Update run trigger API with location support

**Frontend:**
- [ ] Build job type selector
- [ ] Add location selector (dropdown)
- [ ] Implement test compatibility filtering
- [ ] Show location badge in UI

**Testing:**
- [ ] E2E: Create k6 test → Create k6 job → Trigger run
- [ ] Verify job/test type validation
- [ ] Test location parameter passing

### Phase 4: Console Streaming (Week 4)

**Backend:**
- [ ] Implement SSE endpoint (`/api/runs/[id]/stream`)
- [ ] Stream k6 stdout to Redis
- [ ] Handle SSE connection lifecycle

**Frontend:**
- [ ] Build `ConsoleStream` component
- [ ] Implement auto-scroll
- [ ] Handle connection cleanup
- [ ] Show "Waiting for output..." state

**Testing:**
- [ ] Test SSE with 3+ concurrent streams
- [ ] Verify console output completeness
- [ ] Test reconnection on network issues

### Phase 5: Reports & UI Polish (Week 5)

**Backend:**
- [ ] Verify k6 web dashboard generation
- [ ] Store summary.json in database
- [ ] Extract key metrics for quick view
- [ ] Upload artifacts to S3

**Frontend:**
- [ ] Embed HTML report in iframe
- [ ] Build run detail view
- [ ] Display metrics summary cards
- [ ] Add location badge to run header

**Testing:**
- [ ] Verify HTML report loads correctly
- [ ] Test iframe CSP policies
- [ ] Validate metrics extraction

### Phase 6: Parallel Execution Testing (Week 6)

**Backend:**
- [ ] Configure concurrency limits
- [ ] Add resource monitoring
- [ ] Test location filtering with multiple workers

**Testing:**
- [ ] Load test: 5 concurrent k6 runs
- [ ] Monitor CPU/memory usage
- [ ] Verify no file conflicts
- [ ] Test worker location filtering

### Phase 7: Production Readiness (Week 7)

**Infrastructure:**
- [ ] Configure S3 lifecycle policies
- [ ] Set up monitoring/alerting
- [ ] Add usage quotas
- [ ] Document multi-region deployment

**Security:**
- [ ] Audit script validation
- [ ] Implement rate limiting
- [ ] Add timeout enforcement
- [ ] Review error handling

**Testing:**
- [ ] Security audit: Script injection attempts
- [ ] Load testing: 20 concurrent runs
- [ ] Chaos testing: Worker failures, S3 outages
- [ ] Multi-region simulation

### Phase 8: Beta & Launch (Week 8)

- [ ] Enable for internal testing
- [ ] Collect feedback
- [ ] Fix bugs and edge cases
- [ ] Write user documentation
- [ ] Create tutorial videos
- [ ] Prepare announcement
- [ ] Launch to all users

---

## Testing Strategy

### Unit Tests

**Frontend:**
- [ ] k6 script validation logic
- [ ] Location selector component
- [ ] Console stream component

**Backend:**
- [ ] K6ExecutionService
- [ ] Location filtering logic
- [ ] Metrics extraction

### Integration Tests

**Worker:**
- [ ] k6 binary execution
- [ ] S3 upload for k6 artifacts
- [ ] Redis pub/sub for console streaming
- [ ] Location-based job filtering

**API:**
- [ ] Create performance test
- [ ] Create k6 job
- [ ] Trigger run with location
- [ ] SSE endpoint

### End-to-End Tests

- [ ] Full flow: Create test → Job → Run → View console → View report
- [ ] Multi-location: Deploy 2 workers → Trigger from different locations
- [ ] Parallel execution: Trigger 5 runs simultaneously
- [ ] Error handling: Invalid script, timeout, S3 failure

---

## Summary

### What You Get

✅ **Performance Test type** (5th test type)
✅ **Single test execution** (run from playground with live console)
✅ **K6 Job type** (multiple tests with location selector)
✅ **Location-based execution** (single queue + worker filtering)
✅ **Real-time console** (raw k6 stdout via SSE, NO loader!)
✅ **k6 web dashboard** (interactive HTML report in iframe)
✅ **Parallel execution** (2-3 concurrent)
✅ **Clean UI** (hide incompatible fields for performance tests)
✅ **Scalable architecture** (MVP → multi-region)
✅ **Production-ready** in 8 weeks

### Deployment Modes

**Mode 1: MVP (Single Worker)**
- Location is metadata
- Worker processes all jobs
- Quick to deploy

**Mode 2: Multi-Region (Production)**
- Deploy workers in us-east, eu-central, asia-pacific
- Enable location filtering
- True geo-distributed execution

### Migration Path

```
1. Start → Single worker, ENABLE_LOCATION_FILTERING=false
2. Upgrade → Deploy regional workers, ENABLE_LOCATION_FILTERING=true
3. Done → True multi-region performance testing!
```

---

**Document Version:** 1.0 Final
**Last Updated:** 2025-01-01
**Status:** ✅ Ready for Implementation
**Estimated Timeline:** 8 weeks to production
