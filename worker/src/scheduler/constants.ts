/**
 * Scheduler Queue Constants
 *
 * CRITICAL: Queue names must match exactly across all components:
 * - App queue definitions in app/src/lib/queue.ts
 * - Worker processors in worker/src/execution/processors/
 * - KEDA ScaledObjects in deploy/k8s/keda-scaledobject.yaml
 *
 * DO NOT use environment variable overrides for queue names as this can
 * cause jobs to be routed to non-existent queues.
 */

// Scheduler queues - process scheduling triggers
export const JOB_SCHEDULER_QUEUE = 'job-scheduler';
export const K6_JOB_SCHEDULER_QUEUE = 'k6-job-scheduler';
export const MONITOR_SCHEDULER_QUEUE = 'monitor-scheduler';

// Execution queues - where scheduled jobs are enqueued
// These MUST match the queue constants in execution and k6 modules
export const JOB_EXECUTION_QUEUE = 'playwright-global'; // Playwright jobs - no env override!
export const K6_JOB_EXECUTION_QUEUE = 'k6-global'; // K6 jobs - global queue

// Legacy queue name - not used, monitors use regional queues
// Kept for backward compatibility with any existing jobs
export const MONITOR_EXECUTION_QUEUE = 'monitor-execution';

export const EXECUTE_MONITOR_JOB_NAME = 'executeMonitorJob';

// Re-exporting from execution/interfaces
export {
  JobExecutionTask,
  TestExecutionTask,
  MonitorJobData,
} from '../execution/interfaces';
