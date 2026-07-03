---
name: queue-system
description: "Use when: working with the BullMQ execution queue, debugging test runners, capacity management, scheduling jobs, multi-region workers, or handling queue events via SSE."
---

# SuperCheck Queue System Architecture

## Core Concepts

SuperCheck relies on a robust **BullMQ** queue system with **Redis** as the storage backend.

### Key Workloads
1. **Execution**: Playwright tests (`playwright-global`), K6 performance tests (`k6-*`), and synthetic monitors (`monitor-*`).
2. **Scheduling**: Playwright cron jobs (`job-scheduler`), K6 cron jobs (`k6-job-scheduler`), monitor intervals (`monitor-scheduler`).
3. **Utility**: Email rendering (`email-template-render`) and data cleanup (`data-lifecycle-cleanup`).

### Multi-Region Execution
- **Regional Queues**: Workers pick up jobs from their respective regions (e.g., `us-east`, `eu-central`, `asia-pacific`).
- **Global Queues**: `playwright-global` and `k6-global` are processed by any available worker.
- **Worker Configuration**: The `WORKER_LOCATION` environment variable determines which regional queues a worker listens to.

### Capacity Management & Rate Limiting
- **Strict Enforcement**: Capacity limits are enforced using atomic Redis Lua scripts (`reserveSlot`).
- **Counters**: Running and queued jobs are tracked per organization using Redis counters and sets (`capacity:running:{orgId}`, `capacity:queued:{orgId}`).
- **Self-Hosted Override**: For self-hosted modes, `RUNNING_CAPACITY` and `QUEUED_CAPACITY` environment variables can override defaults.

### Connection Best Practices
- **Shared Connections**: General queue operations share a base Redis connection to optimize connection usage.
- **QueueEvents Requirements**: Each `QueueEvents` instance (for listening to job updates and SSE) MUST have its own independent Redis connection because it uses blocking commands (`XREAD BLOCK`). Never share a connection for `QueueEvents`.
- **Reconnection Logic**: Redis connection settings in SuperCheck intentionally use `maxRetriesPerRequest: null` and a never-ending `retryStrategy` to ensure resilience during Redis Sentinel failovers.

### Schedulers Run in the App
- Scheduler queues (`job-scheduler`, etc.) are processed by the **Next.js App** containers, not the workers.
- This ensures scheduled jobs go through the central capacity management system before being dispatched to the actual execution queues.
- **Important**: Worker processes explicitly filter out `-scheduler` queues during dynamic discovery to avoid processing mismatched payloads.

## Troubleshooting Guidelines

1. **Job Cancellation**: When a user cancels a job, if it's already active, a Redis flag `supercheck:cancel:{runId}` is set. The worker polls this and force-kills the K8s execution pod if necessary.
2. **Stalled Jobs**: Check `maxStalledCount` and ensure `lockDuration` is set longer than the maximum possible execution time of a job (usually > 60 minutes).
3. **Redis Exhaustion**: In managed Redis setups (like ElastiCache), watch out for connection limits. App pods can consume ~15 connections each due to `QueueEvents`.
