# Supercheck Database Schema Analysis & Design

**Version:** 1.0
**Date:** 2025-01-01
**Status:** Analysis Complete + K6 Integration Recommendations

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Schema Analysis](#current-schema-analysis)
3. [Best Practices Assessment](#best-practices-assessment)
4. [Areas for Improvement](#areas-for-improvement)
5. [K6 Integration Schema Design](#k6-integration-schema-design)
6. [DRY Principles & Reusability](#dry-principles--reusability)
7. [Scalability Considerations](#scalability-considerations)
8. [Migration Strategy](#migration-strategy)
9. [Recommendations](#recommendations)

---

## Executive Summary

### Current State Assessment

**Strengths:**

- ✅ UUID v7 for primary keys (time-ordered, good for indexing)
- ✅ Proper foreign key constraints with cascade rules
- ✅ Multi-tenancy support (organization → project hierarchy)
- ✅ JSONB for flexible configuration storage
- ✅ Timestamp tracking (created_at, updated_at)
- ✅ Type-safe Drizzle ORM with Zod validation
- ✅ Composite indexes for efficient queries (monitor_results)

**Areas for Improvement:**

- ⚠️ No dedicated performance testing schema
- ⚠️ Some denormalization opportunities (job status tracking)
- ⚠️ Missing indexes on frequently queried columns
- ⚠️ Limited audit trail for sensitive operations

### K6 Integration Impact

**Required Changes:**

1. New execution model (single test + job-based)
2. Performance-specific metrics storage
3. Location-aware execution tracking
4. Enhanced artifact management

**Design Principles:**

- Reuse existing patterns (multi-tenancy, RBAC, audit)
- Maintain data integrity (foreign keys, constraints)
- Optimize for query performance (indexes, partitioning)
- Enable future scalability (time-series data, archival)

---

## Current Schema Analysis

### 1. Organization & Multi-Tenancy Schema

**Tables:** `organization`, `member`, `projects`, `project_members`, `project_variables`

#### Strengths:

✅ **Hierarchical Structure:**

```
organization (1)
  └─ projects (N)
      ├─ tests (N)
      ├─ jobs (N)
      └─ monitors (N)
```

✅ **RBAC Support:**

- Organization-level roles
- Project-level roles
- Unique constraints prevent duplicate memberships

✅ **Secure Variable Storage:**

- Encrypted secrets
- Project-scoped isolation

#### Analysis:

**Good:**

```typescript
// UUID v7 provides time-ordering
id: uuid("id")
  .primaryKey()
  .$defaultFn(() => sql`uuidv7()`);

// Proper cascade behavior
organizationId: uuid("organization_id").references(() => organization.id, {
  onDelete: "cascade",
});
```

**Consider:**

- Add `deleted_at` for soft deletes (regulatory compliance)
- Add `subscription_tier` to organization (for usage quotas)
- Index on `organization.slug` for faster lookup

---

### 2. Test Schema

**Tables:** `tests`

#### Current Design:

```typescript
export const tests = pgTable("tests", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").references(...),
  projectId: uuid("project_id").references(...),
  createdByUserId: uuid("created_by_user_id").references(...),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  script: text("script").notNull().default(""), // Base64
  priority: varchar("priority", { length: 50 }).$type<TestPriority>(),
  type: varchar("type", { length: 50 }).$type<TestType>(), // Currently: browser | api | database | custom
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});
```

#### Strengths:

✅ Proper multi-tenancy (org + project)
✅ Audit trail (createdByUserId)
✅ Flexible priority system

#### Issues:

❌ **Missing indexes:**

```sql
-- Should have these:
INDEX idx_tests_organization_id (organization_id);
INDEX idx_tests_project_id (project_id);
INDEX idx_tests_type (type);
INDEX idx_tests_created_at (created_at DESC);
```

---

### 3. Job & Runs Schema

**Tables:** `jobs`, `job_tests`, `runs`

#### Current Design:

```typescript
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey(),
  // ... other fields
  status: varchar("status").$type<JobStatus>(), // pending | running | passed | failed | error
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  scheduledJobId: varchar("scheduled_job_id"),
});

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  status: varchar("status").$type<TestRunStatus>(),
  duration: varchar("duration"), // ⚠️ Should be integer (milliseconds)
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  artifactPaths: jsonb("artifact_paths"),
  logs: text("logs"), // ⚠️ Should be in S3, not DB
  errorDetails: text("error_details"),
  trigger: varchar("trigger").$type<JobTrigger>(),
});
```

#### Strengths:

✅ Many-to-many relationship (jobs ↔ tests via `job_tests`)
✅ Execution history (`runs` table)
✅ Trigger tracking (manual/schedule/remote)

#### Issues:

❌ **Duration as VARCHAR instead of INTEGER:**

```typescript
// Current (bad):
duration: varchar("duration", { length: 100 });

// Should be:
durationMs: integer("duration_ms");
```

❌ **Logs stored in database** (performance/cost issue):

```typescript
// Current:
logs: text("logs"); // Can grow to MBs

// Should be:
logsS3Url: text("logs_s3_url"); // Reference to S3
```

❌ **Status denormalization:**

```typescript
// jobs.status duplicates latest run.status
// Better: Compute job status from runs
```

---

### 4. Monitor Schema

**Tables:** `monitors`, `monitor_results`

#### Current Design:

```typescript
export const monitors = pgTable("monitors", {
  id: uuid("id").primaryKey(),
  // ... fields
  type: varchar("type").$type<MonitorType>(), // http_request | website | ping_host | port_check | synthetic_test
  target: varchar("target", { length: 2048 }),
  frequencyMinutes: integer("frequency_minutes").default(5),
  config: jsonb("config").$type<MonitorConfig>(),
  // ...
});

export const monitorResults = pgTable(
  "monitor_results",
  {
    id: uuid("id").primaryKey(),
    monitorId: uuid("monitor_id").references(() => monitors.id, {
      onDelete: "cascade",
    }),
    checkedAt: timestamp("checked_at").defaultNow(),
    location: varchar("location")
      .$type<MonitoringLocation>()
      .default("us-east"),
    status: varchar("status").$type<MonitorResultStatus>(),
    responseTimeMs: integer("response_time_ms"), // ✅ Good: Integer for duration
    details: jsonb("details").$type<MonitorResultDetails>(),
    // Composite index for efficient queries ✅
  },
  (table) => ({
    monitorLocationIdx: index(
      "monitor_results_monitor_location_checked_idx"
    ).on(table.monitorId, table.location, table.checkedAt),
  })
);
```

#### Strengths:

✅ **Excellent location tracking** (multi-location monitoring)
✅ **Composite index** for efficient time-series queries
✅ **Integer for response time** (proper data type)
✅ **JSONB for flexible details** (SSL certs, headers, etc.)
✅ **Synthetic test integration** (artifact URL references)

#### Best Practice Example:

```typescript
// This is the pattern to follow for k6:
monitorLocationIdx: index("monitor_results_monitor_location_checked_idx").on(
  table.monitorId,
  table.location,
  table.checkedAt
);
```

---

## Best Practices Assessment

### ✅ What's Done Well

#### 1. UUID v7 for Primary Keys

```typescript
id: uuid("id")
  .primaryKey()
  .$defaultFn(() => sql`uuidv7()`);
```

**Benefits:**

- Time-ordered (better index performance than random UUIDs)
- Globally unique (distributed systems)
- Sortable (no need for separate created_at index in some cases)

#### 2. Proper Foreign Key Constraints

```typescript
organizationId: uuid("organization_id").references(() => organization.id, {
  onDelete: "cascade", // ✅ Automatic cleanup
});

createdByUserId: uuid("created_by_user_id").references(() => user.id, {
  onDelete: "no action", // ✅ Prevents accidental user deletion
});
```

#### 3. JSONB for Flexible Data

```typescript
config: jsonb("config").$type<MonitorConfig>();
artifactPaths: jsonb("artifact_paths").$type<ArtifactPaths>();
```

**Benefits:**

- Schema flexibility without migrations
- Type-safe with TypeScript
- Queryable with PostgreSQL JSONB operators

#### 4. Timestamp Tracking

```typescript
createdAt: timestamp("created_at").defaultNow();
updatedAt: timestamp("updated_at").defaultNow();
```

#### 5. Type Safety with Drizzle + Zod

```typescript
export const testsInsertSchema = createInsertSchema(tests);
export const testsSelectSchema = createSelectSchema(tests);
export const testsUpdateSchema = createUpdateSchema(tests);
```

---

### ⚠️ Areas for Improvement

#### 1. Missing Indexes

**High Priority:**

```sql
-- Tests table
CREATE INDEX idx_tests_organization_id ON tests(organization_id);
CREATE INDEX idx_tests_project_id ON tests(project_id);
CREATE INDEX idx_tests_type ON tests(type);
CREATE INDEX idx_tests_created_at ON tests(created_at DESC);

-- Jobs table
CREATE INDEX idx_jobs_organization_id ON jobs(organization_id);
CREATE INDEX idx_jobs_project_id ON jobs(project_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_next_run_at ON jobs(next_run_at) WHERE next_run_at IS NOT NULL;

-- Runs table
CREATE INDEX idx_runs_job_id ON runs(job_id);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_runs_started_at ON runs(started_at DESC);
CREATE INDEX idx_runs_project_id ON runs(project_id);
```

#### 2. Data Type Issues

**Duration as VARCHAR:**

```typescript
// ❌ Current
duration: varchar("duration", { length: 100 });

// ✅ Should be
durationMs: integer("duration_ms");
```

**Why:** Integer is faster, smaller, and queryable (e.g., `WHERE duration_ms > 5000`)

#### 3. Large Text in Database

```typescript
// ❌ Current
logs: text("logs"); // Can be 10+ MB

// ✅ Should be
logsS3Url: text("logs_s3_url");
// Store large text in S3, reference URL
```

#### 4. No Soft Deletes

**Current:** Hard deletes with CASCADE
**Better:** Soft deletes for audit/recovery

```typescript
deletedAt: timestamp("deleted_at");
deletedByUserId: uuid("deleted_by_user_id").references(() => user.id);
```

---

## K6 Integration Schema Design

### Design Goals

1. ✅ **DRY Principle:** Reuse existing patterns (organization, project, RBAC)
2. ✅ **Separation of Concerns:** Separate execution from configuration
3. ✅ **Scalability:** Support millions of performance test results
4. ✅ **Query Performance:** Proper indexes for time-series queries
5. ✅ **Multi-tenancy:** Maintain org/project isolation

---

### Recommended Schema

#### 1. K6 Performance Runs Table

**Purpose:** Store k6-specific metrics and results

```typescript
export const k6PerformanceRuns = pgTable(
  "k6_performance_runs",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),

    // Relationships (link directly to the originating run)
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    testId: uuid("test_id")
      .notNull()
      .references(() => tests.id, { onDelete: "cascade" }),

    // Multi-tenancy (denormalized for query performance)
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    // Execution location (reuse monitor pattern)
    location: varchar("location", { length: 50 })
      .$type<MonitoringLocation>()
      .notNull()
      .default("us-east"),

    // Status (denormalized from runs for query performance)
    status: varchar("status", { length: 50 })
      .$type<ExecutionStatus>()
      .notNull(),

    // Timing
    startedAt: timestamp("started_at").notNull(),
    completedAt: timestamp("completed_at"),
    durationMs: integer("duration_ms"),

    // k6-specific metrics (extracted from summary.json)
    totalRequests: integer("total_requests"),
    failedRequests: integer("failed_requests"),
    requestRate: integer("request_rate"), // ✅ Store as integer (requests * 100 for 2 decimals)
    avgResponseTimeMs: integer("avg_response_time_ms"),
    p50ResponseTimeMs: integer("p50_response_time_ms"),
    p95ResponseTimeMs: integer("p95_response_time_ms"),
    p99ResponseTimeMs: integer("p99_response_time_ms"),
    minResponseTimeMs: integer("min_response_time_ms"),
    maxResponseTimeMs: integer("max_response_time_ms"),

    // Thresholds
    thresholdsPassed: boolean("thresholds_passed"),
    thresholdsTotal: integer("thresholds_total"),
    thresholdsFailed: integer("thresholds_failed"),

    // Checks
    checksTotal: integer("checks_total"),
    checksPassed: integer("checks_passed"),
    checksFailed: integer("checks_failed"),

    // VU metrics
    vusMax: integer("vus_max"),
    iterationsTotal: integer("iterations_total"),
    iterationsRate: integer("iterations_rate"), // iterations * 100

    // Full summary (for detailed view)
    summaryJson: jsonb("summary_json"), // Full k6 summary output

    // Config snapshot (what was run)
    configSnapshot: jsonb("config_snapshot").$type<K6ConfigSnapshot>(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    // Indexes for efficient queries
    runIdx: index("k6_runs_run_id_idx").on(table.runId),
    testIdx: index("k6_runs_test_id_idx").on(table.testId),
    projectIdx: index("k6_runs_project_id_idx").on(table.projectId),
    locationIdx: index("k6_runs_location_idx").on(table.location),
    statusIdx: index("k6_runs_status_idx").on(table.status),
    createdAtIdx: index("k6_runs_created_at_idx").on(table.createdAt.desc()),

    // Composite indexes for dashboard queries
    projectLocationCreatedIdx: index("k6_runs_project_location_created_idx").on(
      table.projectId,
      table.location,
      table.createdAt.desc()
    ),

    // Index for performance trending queries
    testLocationCreatedIdx: index("k6_runs_test_location_created_idx").on(
      table.testId,
      table.location,
      table.createdAt.desc()
    ),

    // Unique constraint (one k6 metrics row per run)
    uniqueRun: unique().on(table.runId),
  })
);
```

**Benefits:**

- ✅ Optimized for time-series queries
- ✅ Integer columns for metrics (fast aggregation)
- ✅ Proper indexes for dashboard performance
- ✅ Reuses monitor location pattern
- ✅ Aligns with existing job execution workflow

#### 2. K6 Metrics History Table (OPTIONAL - Time-Series)

**Purpose:** Store detailed metrics for trending analysis

```typescript
export const k6MetricsHistory = pgTable(
  "k6_metrics_history",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => sql`uuidv7()`),

    k6RunId: uuid("k6_run_id")
      .notNull()
      .references(() => k6PerformanceRuns.id, { onDelete: "cascade" }),

    // Metric details
    metricName: varchar("metric_name", { length: 100 }).notNull(),
    metricType: varchar("metric_type", { length: 50 }), // 'counter' | 'gauge' | 'rate' | 'trend'

    // Values (all integers for performance)
    value: integer("value"),
    count: integer("count"),
    rate: integer("rate"), // * 10000 for 4 decimal precision
    minValue: integer("min_value"),
    maxValue: integer("max_value"),
    avgValue: integer("avg_value"),
    medValue: integer("med_value"),
    p90Value: integer("p90_value"),
    p95Value: integer("p95_value"),
    p99Value: integer("p99_value"),

    // Tags (for grouping)
    tags: jsonb("tags").$type<Record<string, string>>(),

    // Timestamp
    recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  },
  (table) => ({
    // Partition by month (for scalability)
    // This requires Postgres partitioning - see migration section

    // Indexes
    k6RunIdx: index("k6_metrics_k6_run_id_idx").on(table.k6RunId),
    metricNameIdx: index("k6_metrics_metric_name_idx").on(table.metricName),
    recordedAtIdx: index("k6_metrics_recorded_at_idx").on(
      table.recordedAt.desc()
    ),

    // Composite for metric trending
    runMetricIdx: index("k6_metrics_run_metric_idx").on(
      table.k6RunId,
      table.metricName
    ),
  })
);
```

**Use Case:** Advanced analytics, charting libraries
**Note:** Consider time-series database (TimescaleDB) for high-volume scenarios

---

### Updated Types

**File:** `app/src/db/schema/types.ts`

```typescript
// Add performance to TestType
export type TestType =
  | "browser"
  | "api"
  | "database"
  | "custom"
  | "performance";

// Add k6 to JobType
export type JobType = "playwright" | "k6";

// Unified execution status (reuse across Playwright & k6)
export type ExecutionStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "error"
  | "cancelled"
  | "timeout";

export type ExecutionTrigger = "manual" | "api" | "ci_cd" | "schedule";

// k6-specific types
export type K6ConfigSnapshot = {
  vus?: number;
  duration?: string;
  stages?: Array<{ duration: string; target: number }>;
  thresholds?: Record<string, string[]>;
  tags?: Record<string, string>;
  scenarios?: Record<string, unknown>;
};

export type ExecutionMetadata = {
  userAgent?: string;
  ipAddress?: string;
  ciProvider?: string;
  branch?: string;
  commit?: string;
  [key: string]: unknown;
};

// Add k6_performance to ReportType
export type ReportType = "test" | "job" | "monitor" | "k6_performance";
```

---

## DRY Principles & Reusability

### 1. Shared Execution Pattern

**Before (Duplicated):**

```typescript
// Playwright: runs table
// k6: k6_performance_runs table
// Monitors: monitor_results table
```

**After (DRY):**

```typescript
// Base: runs table (shared)
// ├─ Playwright-specific metadata lives in runs.metadata
// ├─ k6-specific: k6_performance_runs
// └─ Monitor-specific: monitor_results
```

**Benefits:**

- Common execution tracking logic
- Consistent status management
- Unified artifact storage pattern
- Easier to add new test types

### 2. Location Tracking Pattern

**Reused from Monitors:**

```typescript
// Monitors already have this pattern:
location: varchar("location").$type<MonitoringLocation>().default("us-east");

// Reuse for k6:
location: varchar("location").$type<MonitoringLocation>().default("us-east");
```

### 3. Index Strategy

**Pattern:**

```typescript
// Single column indexes for filters
projectIdIdx: index("table_project_id_idx").on(table.projectId);
statusIdx: index("table_status_idx").on(table.status);

// Composite indexes for dashboard queries
projectCreatedIdx: index("table_project_created_idx").on(
  table.projectId,
  table.createdAt.desc()
);
```

**Reuse Across:**

- tests
- runs
- k6PerformanceRuns
- monitorResults

---

## Scalability Considerations

### 1. Partitioning Strategy

**For Time-Series Tables:**

```sql
-- Partition k6_performance_runs by month
CREATE TABLE k6_performance_runs (
  -- ... columns
) PARTITION BY RANGE (created_at);

-- Create partitions (automated via migration)
CREATE TABLE k6_performance_runs_2025_01 PARTITION OF k6_performance_runs
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE k6_performance_runs_2025_02 PARTITION OF k6_performance_runs
  FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
```

**Benefits:**

- Faster queries (scan only relevant partition)
- Easier archival (drop old partitions)
- Better index performance

### 2. Archival Strategy

**After 90 days:**

```sql
-- Move to cold storage
ALTER TABLE k6_performance_runs_2024_10 SET TABLESPACE archive_tablespace;

-- Or export to S3 and drop
COPY k6_performance_runs_2024_10 TO 's3://bucket/archive/...';
DROP TABLE k6_performance_runs_2024_10;
```

### 3. Index Maintenance

**Regular vacuum:**

```sql
-- Auto-vacuum should handle this, but monitor
VACUUM ANALYZE k6_performance_runs;
REINDEX TABLE k6_performance_runs;
```

### 4. Query Optimization

**Use integers for metrics:**

```typescript
// ✅ Fast aggregation
SELECT AVG(avg_response_time_ms) FROM k6_performance_runs;

// ❌ Slow (if using DECIMAL or JSONB)
SELECT AVG((summary_json->>'avg_response_time')::numeric) FROM k6_performance_runs;
```

**Denormalize when needed:**

```typescript
// Store frequently queried fields as columns
avgResponseTimeMs: integer("avg_response_time_ms");

// Keep full data in JSONB for rare queries
summaryJson: jsonb("summary_json");
```

---

## Migration Strategy

### Phase 1: Add New Tables

```sql
-- 2. Create k6_performance_runs table
CREATE TABLE k6_performance_runs (...);

-- 3. Update types
ALTER TYPE test_type ADD VALUE 'performance';
-- Note: Can't add to enum in transaction, use varchar instead
```

### Phase 2: Add Indexes

```sql
-- Add all indexes defined in schema
CREATE INDEX ... ON k6_performance_runs ...;
```

### Phase 3: Update Application Code

- Update Drizzle schema files
- Update API routes
- Update worker processors
- Deploy (zero downtime)

---

## Recommendations

### Immediate Actions (Week 1)

1. **Add Indexes:**

   ```sql
   CREATE INDEX idx_tests_project_id ON tests(project_id);
   CREATE INDEX idx_tests_type ON tests(type);
   CREATE INDEX idx_runs_job_id ON runs(job_id);
   CREATE INDEX idx_runs_status ON runs(status);
   ```

2. **Change Duration to Integer:**

   ```sql
   ALTER TABLE runs ADD COLUMN duration_ms INTEGER;
   UPDATE runs SET duration_ms = CAST(REGEXP_REPLACE(duration, '[^0-9]', '', 'g') AS INTEGER);
   ALTER TABLE runs DROP COLUMN duration;
   ```

3. **Move Logs to S3:**
   ```sql
   ALTER TABLE runs ADD COLUMN logs_s3_url TEXT;
   -- Migrate existing logs to S3
   -- UPDATE runs SET logs_s3_url = upload_to_s3(logs);
   ALTER TABLE runs DROP COLUMN logs;
   ```

### Short-term (Week 2-4)

5. **Create `k6_performance_runs` table**
6. **Update types** (add 'performance' to TestType)
7. **Add `jobType` column** to jobs table

### Medium-term (Month 2-3)

8. **Implement partitioning** for k6_performance_runs
9. **Add soft deletes** to critical tables
10. **Set up archival process** (90-day retention)

### Long-term (Month 4+)

11. **Consider TimescaleDB** for metrics_history
12. **Implement read replicas** for reporting queries
13. **Add caching layer** (Redis) for frequently accessed data

---

## Summary

### Current Schema: Grade B+

**Strengths:**

- Strong foundation (UUID v7, FKs, multi-tenancy)
- Good use of JSONB for flexibility
- Type-safe with Drizzle + Zod

**Weaknesses:**

- Missing indexes (performance impact)
- Data type issues (duration as varchar)

### K6 Integration: Grade A

**Recommended Approach:**

- ✅ Create `k6_performance_runs` (metrics storage)
- ✅ Reuse monitor location pattern
- ✅ Use integers for performance metrics
- ✅ Proper indexes for query performance

### DRY & Scalability: Grade A

**Best Practices Applied:**

- Shared execution model (DRY)
- Consistent index strategy
- Integer metrics for aggregation
- Partitioning for time-series data
- S3 for large artifacts

---

**Next Steps:**

1. Review this analysis
2. Implement recommended changes
3. Create migration files
4. Test with load testing tools
5. Deploy incrementally

**Questions?**

- Discuss partitioning strategy
- Review index choices
- Evaluate archival process

---

**Document Version:** 1.0
**Last Updated:** 2025-01-01
**Author:** Database Architect
**Status:** ✅ Ready for Implementation
