/**
 * Scheduler Constants
 *
 * Queue names for scheduler processing. These must match the queue names
 * used when adding repeatable jobs (in job creation/update flows).
 */

// Scheduler queues - process scheduling triggers
export const JOB_SCHEDULER_QUEUE = 'job-scheduler';
export const K6_JOB_SCHEDULER_QUEUE = 'k6-job-scheduler';
export const MONITOR_SCHEDULER_QUEUE = 'monitor-scheduler';

// Monitor job name
export const EXECUTE_MONITOR_JOB_NAME = 'executeMonitorJob';

// Default location for K6 jobs
export const DEFAULT_K6_LOCATION = 'eu-central';
