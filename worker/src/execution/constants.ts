// The queue names are now dynamic based on the region and execution type
// Tests use playwright-test-{REGION}, jobs use playwright-job-{REGION}
// Queue names
export const PLAYWRIGHT_QUEUE = process.env.QUEUE_NAME || 'playwright-GLOBAL';

// Job names
export const TEST_EXECUTION_JOB = 'test-execution';
export const JOB_EXECUTION_JOB = 'job-execution';

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
