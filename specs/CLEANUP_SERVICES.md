# Cleanup Services - Complete Architecture

## Overview

This document details the comprehensive data lifecycle management and cleanup services in Supercheck. The system provides enterprise-grade cleanup operations for managing data retention, archival, and resource cleanup across all entities.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│           Data Lifecycle Service (Main Orchestrator)           │
│  - Manages cleanup strategies                                  │
│  - Schedules recurring cleanup jobs                            │
│  - Tracks cleanup metrics and statistics                       │
└────────────────────────┬─────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
   │  Monitor    │  │   Job Runs  │  │ Playground  │
   │  Results    │  │   Cleanup   │  │ Artifacts   │
   │  Cleanup    │  │  Strategy   │  │  Cleanup    │
   └─────────────┘  └─────────────┘  └─────────────┘
        │                │                │
        └────────────────┼────────────────┘
                         │
                         ▼
        ┌────────────────────────────────┐
        │   BullMQ Queue (Redis)         │
        │  data-lifecycle-cleanup        │
        └────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
   ┌─────────┐      ┌─────────┐      ┌─────────┐
   │Database │      │   S3    │      │  Redis  │
   │Cleanup  │      │Cleanup  │      │Cleanup  │
   └─────────┘      └─────────┘      └─────────┘
```

---

## Cleanup Strategies

### 1. Monitor Results Cleanup Strategy

**Purpose:** Manage retention of monitor check results to prevent database bloat.

**Configuration:**
- Entity Type: monitor_results
- Enabled by default
- Cron Schedule: 2 AM daily (0 2 * * *)
- Retention Days: 30
- Batch Size: 1000 records per batch
- Max Records Per Run: 1,000,000

**Environment Variables:**
- MONITOR_CLEANUP_ENABLED: true
- MONITOR_CLEANUP_CRON: "0 2 * * *"
- MONITOR_RETENTION_DAYS: 30
- MONITOR_CLEANUP_BATCH_SIZE: 1000
- MONITOR_CLEANUP_SAFETY_LIMIT: 1000000

**Cleanup Logic:**
- Calculates cutoff date based on retention days
- Queries for records older than cutoff date
- Preserves status change records (important for alerting history)
- Deletes records in batches to avoid overwhelming database
- Adds 100ms delay between batches
- Returns detailed results including count and duration

**What Gets Deleted:**
- ✅ Old monitor check results (older than retention period)
- ❌ Status change records (preserved for alerting history)
- ❌ Recent results (within retention period)

**What's Preserved:**
- Status change events (important for alert history)
- Recent check results (within retention days)
- Monitor configuration

---

### 2. Job Runs Cleanup Strategy

**Purpose:** Manage retention of job execution runs and associated artifacts.

**Configuration:**
- Entity Type: job_runs
- Disabled by default (opt-in)
- Cron Schedule: 3 AM daily (0 3 * * *)
- Retention Days: 90
- Batch Size: 100 records per batch (smaller for complex operations)
- Max Records Per Run: 10,000

**Environment Variables:**
- JOB_RUNS_CLEANUP_ENABLED: false (disabled by default)
- JOB_RUNS_CLEANUP_CRON: "0 3 * * *"
- JOB_RUNS_RETENTION_DAYS: 90
- JOB_RUNS_CLEANUP_BATCH_SIZE: 100
- JOB_RUNS_CLEANUP_SAFETY_LIMIT: 10000

**Cleanup Logic:**
- Finds old runs based on creation date and retention period
- Retrieves associated reports from reports table
- Deletes S3 artifacts (reports, traces, screenshots)
- Deletes report records from database
- Deletes run records from database
- Supports dry-run mode for testing

**Cascading Deletion:**
```
1. Find old runs (older than retention period)
   ↓
2. Find associated reports in reports table
   ↓
3. Delete S3 objects (reports, artifacts)
   ↓
4. Delete report records from database
   ↓
5. Delete run records from database
```

**What Gets Deleted:**
- ✅ Old run records (older than retention period)
- ✅ Associated reports from reports table
- ✅ S3 artifacts (reports, traces, screenshots)
- ❌ Recent runs (within retention period)

**What's Preserved:**
- Recent job runs
- Active job configurations
- Recent reports

---

### 3. Playground Artifacts Cleanup Strategy

**Purpose:** Clean up temporary test artifacts from playground executions.

**Configuration:**
- Entity Type: playground_artifacts
- Disabled by default (opt-in)
- Cron Schedule: Every 12 hours (0 */12 * * *)
- Max Age Hours: 24 (delete artifacts older than 24 hours)
- S3 Bucket: playwright-test-artifacts

**Environment Variables:**
- PLAYGROUND_CLEANUP_ENABLED: false (disabled by default)
- PLAYGROUND_CLEANUP_CRON: "0 */12 * * *"
- PLAYGROUND_CLEANUP_MAX_AGE_HOURS: 24
- S3_TEST_BUCKET_NAME: "playwright-test-artifacts"

**Cleanup Logic:**
- Lists all objects in S3 playground artifacts bucket
- Paginates through objects (1000 per request)
- Filters objects older than maxAgeHours
- Deletes old S3 objects
- Supports dry-run mode for testing

**What Gets Deleted:**
- ✅ S3 playground artifacts older than maxAgeHours
- ✅ Test reports from playground executions
- ✅ Screenshots and traces from playground tests
- ❌ Recent playground artifacts

**What's Preserved:**
- Recent playground artifacts
- Saved test reports

---

## Data Lifecycle Service

### Main Service Class

The DataLifecycleService orchestrates all cleanup operations:
- Manages cleanup strategies for different entity types
- Creates and manages BullMQ queue for cleanup jobs
- Schedules recurring cleanup based on cron patterns
- Supports manual cleanup triggering
- Provides status monitoring and statistics
- Handles graceful shutdown

---

## Cleanup Execution Flow

### Scheduled Cleanup

```
1. Cron trigger fires at scheduled time
   ↓
2. BullMQ creates job in data-lifecycle-cleanup queue
   ↓
3. Worker picks up job
   ├─ Get strategy for entity type
   ├─ Call strategy.execute()
   └─ Return result
   ↓
4. Strategy execution
   ├─ Calculate cutoff date/time
   ├─ Query for old records
   ├─ Delete in batches
   ├─ Collect metrics
   └─ Return result
   ↓
5. Result handling
   ├─ Log completion
   ├─ Update metrics
   ├─ Emit completion event
   └─ Remove job from queue
```

### Manual Cleanup

Manual cleanup can be triggered via API endpoint:
- Endpoint: POST /api/cleanup/trigger
- Parameters: entityType, dryRun (optional)
- Returns: Success status, records deleted, duration, errors, and details

---

## Dry-Run Mode

### Purpose
Test cleanup operations without actually deleting data.

### Usage

Trigger dry-run cleanup to test operations without deleting data:
- Call triggerManualCleanup with entity type and dryRun flag
- Result shows what would be deleted
- Cutoff date and iteration count provided in details

### Behavior

| Operation | Normal Mode | Dry-Run Mode |
|-----------|------------|------------|
| Query old records | ✅ | ✅ |
| Count records | ✅ | ✅ |
| Delete from DB | ✅ | ❌ |
| Delete from S3 | ✅ | ❌ |
| Return metrics | ✅ | ✅ |

---

## Statistics & Monitoring

### Get Cleanup Status

Retrieve current cleanup status:
- Enabled strategies list
- Queue status (waiting, active, completed, failed)
- Statistics per strategy (total records, old records)

### Statistics Per Strategy

Each strategy provides:
- Total records in table
- Old records count (eligible for deletion)

---

## Configuration & Tuning

### Environment Variables

Configure cleanup operations via environment variables for each strategy type (Monitor Results, Job Runs, Playground Artifacts). Each includes: enabled flag, cron schedule, retention period, batch size, and safety limits.

### Tuning Guidelines

**For High-Volume Environments:**
- Increase batch size for faster cleanup
- Increase safety limits
- More frequent cleanup schedules
- Shorter retention periods

**For Low-Volume Environments:**
- Smaller batches to reduce database load
- Less frequent cleanup schedules
- Longer retention periods

---

## Error Handling

### Retry Strategy

- Attempts: 2 (retry failed cleanup once)
- Backoff type: Exponential
- Initial delay: 60 seconds

### Common Errors

| Error | Cause | Resolution |
|-------|-------|-----------|
| "No strategy found" | Invalid entity type | Check entity type spelling |
| "Database connection failed" | DB unavailable | Check DB connection |
| "S3 cleanup had failures" | S3 permission/network issue | Check S3 credentials |
| "Cleanup queue not initialized" | Service not initialized | Call initialize() first |

### Error Logging

- Errors logged with context and entity type
- Failed jobs retained for 7 days for debugging
- Up to 50 failed jobs kept in queue

---

## Performance Metrics

### Cleanup Duration

- **Monitor Results**: ~5-30 seconds (depends on batch size)
- **Job Runs**: ~30-120 seconds (includes S3 deletion)
- **Playground Artifacts**: ~10-60 seconds (depends on S3 objects)

### Database Impact

- Batch size: 1000 records
- Delay between batches: 100ms
- Prevents overwhelming database
- Minimal impact on running queries

### S3 Impact

- Paginated listing (1000 objects per request)
- Batch deletion
- Minimal impact on S3 performance

---

## Best Practices

### 1. Enable Cleanup Gradually
- Start with monitor results cleanup (safest)
- Enable job runs cleanup after monitoring
- Enable playground cleanup as needed

### 2. Test with Dry-Run First
- Always test cleanup operations before enabling
- Use dry-run mode to preview what would be deleted
- Review record counts and cutoff dates

### 3. Monitor Cleanup Jobs
- Check status regularly
- Monitor for failed jobs
- Review queue statistics

### 4. Adjust Retention Based on Storage
- Reduce retention if storage is growing
- Increase retention if storage is stable
- Balance between history and storage usage

### 5. Schedule During Off-Peak
- Schedule cleanup during low-traffic hours
- Monitor Results: 2 AM daily
- Job Runs: 3 AM daily
- Playground Artifacts: Every 12 hours

---

## Summary

The cleanup services provide:

✅ **Pluggable cleanup strategies** for different entity types  
✅ **Distributed job queue** via BullMQ/Redis  
✅ **Configurable retention policies** per entity  
✅ **Dry-run support** for testing  
✅ **Comprehensive error handling** with retries  
✅ **Detailed metrics and logging** for monitoring  
✅ **Cascading deletion** for related records  
✅ **Batch processing** to minimize DB impact  

