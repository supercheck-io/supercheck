import type { MonitoringLocation } from '../common/location/location.service';

export const MONITOR_EXECUTION_QUEUE =
  process.env.QUEUE_NAME || 'monitor-global';

export const REGIONS = [
  'us-east',
  'eu-central',
  'asia-pacific',
  'global',
] as const;

export const MONITOR_QUEUES = {
  US_EAST: 'monitor-us-east',
  EU_CENTRAL: 'monitor-eu-central',
  ASIA_PACIFIC: 'monitor-asia-pacific',
  GLOBAL: 'monitor-global',
};
export const EXECUTE_MONITOR_JOB_NAME = 'executeMonitorJob';
export const WORKER_LOCATION =
  (process.env.WORKER_LOCATION as MonitoringLocation | undefined) || undefined;
