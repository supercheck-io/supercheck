export const JOB_SCHEDULER_QUEUE = 'job-scheduler';
export const MONITOR_SCHEDULER_QUEUE = 'monitor-scheduler';
export const JOB_EXECUTION_QUEUE = 'job-execution';
export const MONITOR_EXECUTION_QUEUE = 'monitor-execution';

export const EXECUTE_MONITOR_JOB_NAME = 'executeMonitorJob';

// Re-exporting from execution/interfaces
export {
  JobExecutionTask,
  TestExecutionTask,
  MonitorJobData,
} from '../execution/interfaces';
