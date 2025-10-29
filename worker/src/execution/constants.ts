export const JOB_EXECUTION_QUEUE = 'job-execution';
export const TEST_EXECUTION_QUEUE = 'test-execution';

// Default capacity limits that should match the frontend settings
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
