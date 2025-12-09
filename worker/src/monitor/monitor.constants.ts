import type { MonitoringLocation } from '../common/location/location.service';

/**
 * Monitor Queue Constants
 *
 * CRITICAL: Queue names must match exactly across all components:
 * - App queue definitions in app/src/lib/queue.ts
 * - Scheduler constants in worker/src/scheduler/constants.ts
 * - KEDA ScaledObjects in deploy/k8s/keda-scaledobject.yaml
 *
 * Monitors use REGIONAL queues (MONITOR_QUEUES) for location-specific execution.
 * The MONITOR_EXECUTION_QUEUE is a legacy fallback and should rarely be used.
 */

// Legacy monitor execution queue - DO NOT override with environment variable
// Monitors should use regional queues (MONITOR_QUEUES) for proper location routing
export const MONITOR_EXECUTION_QUEUE = 'monitor-global';

// Available regions for monitor execution
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
