/**
 * K6 Queue Constants
 *
 * CRITICAL: Queue names must match exactly across all components:
 * - App queue definitions in app/src/lib/queue.ts
 * - Scheduler constants in worker/src/scheduler/constants.ts
 * - KEDA ScaledObjects in deploy/k8s/keda-scaledobject.yaml
 *
 * K6 uses regional queues for location-specific execution.
 * The K6_QUEUE constant is the default global queue.
 */

// K6 global queue - DO NOT override with environment variable
// Regional workers also process this queue for "global" location jobs
export const K6_QUEUE = 'k6-global';

// Available regions for K6 execution
export const REGIONS = [
  'us-east',
  'eu-central',
  'asia-pacific',
  'global',
] as const;
export type Region = (typeof REGIONS)[number];

export const K6_QUEUES = {
  US_EAST: 'k6-us-east',
  EU_CENTRAL: 'k6-eu-central',
  ASIA_PACIFIC: 'k6-asia-pacific',
  GLOBAL: 'k6-global',
};
