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
export const JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes that should match the frontend settings

// Capacity limits (per-organization)
export const RUNNING_CAPACITY = parseInt(
  process.env.RUNNING_CAPACITY || '2',
  10,
);

/**
 * QUEUED_CAPACITY defines the maximum number of jobs that can be in the queue.
 * The API layer will reject new job submissions once this limit is reached.
 * This is a safety measure to prevent overwhelming the queue with too many jobs.
 */
export const QUEUED_CAPACITY = parseInt(
  process.env.QUEUED_CAPACITY || '10',
  10,
);
