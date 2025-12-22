import type { MonitoringLocation } from '../common/location/location.service';

/**
 * Monitor Queue Constants
 *
 * CRITICAL: Queue names must match exactly across all components:
 * - App queue definitions in app/src/lib/queue.ts
 * - Scheduler constants in worker/src/scheduler/constants.ts
 * - KEDA ScaledObjects in deploy/k8s/keda-scaledobject.yaml
 *
 * Architecture:
 * - Monitors MUST run in their specified location for accurate latency data
 * - Each regional worker processes ONLY its regional queue
 * - No global/fallback queue - location accuracy is critical
 */

// Available regions for monitor execution
export const REGIONS = ['us-east', 'eu-central', 'asia-pacific'] as const;

// Queue names for each region
export const MONITOR_QUEUES = {
  US_EAST: 'monitor-us-east',
  EU_CENTRAL: 'monitor-eu-central',
  ASIA_PACIFIC: 'monitor-asia-pacific',
};

// Job name used when adding monitor jobs to queues
export const EXECUTE_MONITOR_JOB_NAME = 'executeMonitorJob';

// Worker location from environment (optional - only set in production)
export const WORKER_LOCATION =
  (process.env.WORKER_LOCATION as MonitoringLocation | undefined) || undefined;
