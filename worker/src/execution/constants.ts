/**
 * Execution Queue Constants
 *
 * CRITICAL: Queue names must match exactly across all components:
 * - App queue definitions in app/src/lib/queue.ts
 * - Scheduler constants in worker/src/scheduler/constants.ts
 * - KEDA ScaledObjects in deploy/k8s/keda-scaledobject.yaml
 *
 * Playwright uses a single global queue for all tests and jobs.
 * K6 uses regional queues (see k6.constants.ts for regional queue names).
 */

// Playwright global queue - DO NOT override with environment variable
// All workers process this queue regardless of region
export const PLAYWRIGHT_QUEUE = 'playwright-global';

// Timeouts
// NOTE: The canonical timeout values are in common/constants/timeouts.constants.ts
// Use TIMEOUTS.JOB_EXECUTION_DEFAULT_MS (60 min) for job timeouts.
// This constant is kept for backward compatibility but should not be used directly.
export const JOB_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes - matches TIMEOUTS.JOB_EXECUTION_DEFAULT_MS

// Note: RUNNING_CAPACITY and QUEUED_CAPACITY are App-side settings only.
// The App uses them to gate how many test runs can enter the queue.
// Workers simply execute whatever jobs BullMQ dispatches to them.
// Scale execution throughput via WORKER_REPLICAS, not capacity constants.
