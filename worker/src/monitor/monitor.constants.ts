import type { MonitoringLocation } from '../common/location/location.service';

export const MONITOR_EXECUTION_QUEUE = 'monitor-execution';
export const EXECUTE_MONITOR_JOB_NAME = 'executeMonitorJob';
export const IS_DISTRIBUTED_MULTI_LOCATION =
  (process.env.MULTI_LOCATION_DISTRIBUTED || '').toLowerCase() === 'true';
export const WORKER_LOCATION =
  (process.env.WORKER_LOCATION as MonitoringLocation | undefined) || undefined;
