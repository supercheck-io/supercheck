import type { MonitoringLocation } from '../common/location/location.service';

export const MONITOR_EXECUTION_QUEUE = process.env.QUEUE_NAME || 'monitor-GLOBAL';

export const REGIONS = ['US', 'EU', 'APAC', 'GLOBAL'] as const;

export const MONITOR_QUEUES = {
  US: 'monitor-US',
  EU: 'monitor-EU',
  APAC: 'monitor-APAC',
  GLOBAL: 'monitor-GLOBAL',
};
export const EXECUTE_MONITOR_JOB_NAME = 'executeMonitorJob';
export const IS_DISTRIBUTED_MULTI_LOCATION =
  (process.env.MULTI_LOCATION_DISTRIBUTED || '').toLowerCase() === 'true';
export const WORKER_LOCATION =
  (process.env.WORKER_LOCATION as MonitoringLocation | undefined) || undefined;
