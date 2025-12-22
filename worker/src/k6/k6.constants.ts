/**
 * K6 Queue Constants
 *
 * CRITICAL: Queue names must match exactly across all components:
 * - App queue definitions in app/src/lib/queue.ts
 * - Scheduler constants in worker/src/scheduler/constants.ts
 * - KEDA ScaledObjects in deploy/k8s/keda-scaledobject.yaml
 *
 * Architecture:
 * - K6_QUEUE (k6-global): For jobs without specific location, processed by ALL workers
 * - K6_QUEUES.{region}: For location-specific jobs, processed by that region's worker
 * - Each regional worker processes BOTH its regional queue AND the global queue
 */

// K6 global queue - processed by all regional workers for load balancing
export const K6_QUEUE = 'k6-global';

// Available regions for K6 execution (excludes 'global' - use K6_QUEUE for global)
export const REGIONS = ['us-east', 'eu-central', 'asia-pacific'] as const;
export type Region = (typeof REGIONS)[number];

export const K6_QUEUES = {
  US_EAST: 'k6-us-east',
  EU_CENTRAL: 'k6-eu-central',
  ASIA_PACIFIC: 'k6-asia-pacific',
  GLOBAL: 'k6-global', // Alias for K6_QUEUE
};
