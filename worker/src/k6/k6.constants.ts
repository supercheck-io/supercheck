// The queue names are now dynamic based on the region and execution type
export const K6_QUEUE = process.env.QUEUE_NAME || 'k6-GLOBAL';

export const REGIONS = ['US', 'EU', 'APAC', 'GLOBAL'] as const;
export type Region = typeof REGIONS[number];

export const K6_QUEUES = {
  US: 'k6-US',
  EU: 'k6-EU',
  APAC: 'k6-APAC',
  GLOBAL: 'k6-GLOBAL',
};

// Job names are no longer used since we have separate queues
export const K6_TEST_EXECUTION_JOB_NAME = 'k6-test-execution';
export const K6_JOB_EXECUTION_JOB_NAME = 'k6-job-execution';
