// Playwright tests use a single global queue
// K6 tests use regional queues (see k6.constants.ts for regional queue names)
// Queue names
export const PLAYWRIGHT_QUEUE = process.env.QUEUE_NAME || 'playwright-global';

// Limits
export const CONCURRENT_JOB_LIMIT = 5;
export const JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes that should match the frontend settings
export const RUNNING_CAPACITY = parseInt(
  process.env.RUNNING_CAPACITY || '5',
  10,
);

/**
 * QUEUED_CAPACITY defines the maximum number of jobs that can be in the queue.
 * The API layer will reject new job submissions once this limit is reached.
 * This is a safety measure to prevent overwhelming the queue with too many jobs.
 */
export const QUEUED_CAPACITY = parseInt(
  process.env.QUEUED_CAPACITY || '50',
  10,
);
