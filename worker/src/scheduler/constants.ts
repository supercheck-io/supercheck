export const JOB_SCHEDULER_QUEUE = 'job-scheduler';
export const MONITOR_SCHEDULER_QUEUE = 'monitor-scheduler';
// IMPORTANT: These must match the queue names used by the execution processors
// PlaywrightExecutionProcessor uses PLAYWRIGHT_QUEUE = 'playwright-global'
// K6ExecutionProcessor uses K6_QUEUE = 'k6-global'
export const JOB_EXECUTION_QUEUE = process.env.QUEUE_NAME || 'playwright-global';
export const K6_JOB_SCHEDULER_QUEUE = 'k6-job-scheduler';
export const K6_JOB_EXECUTION_QUEUE = 'k6-global';
export const MONITOR_EXECUTION_QUEUE = 'monitor-execution';

export const EXECUTE_MONITOR_JOB_NAME = 'executeMonitorJob';

// Re-exporting from execution/interfaces
export {
  JobExecutionTask,
  TestExecutionTask,
  MonitorJobData,
} from '../execution/interfaces';
