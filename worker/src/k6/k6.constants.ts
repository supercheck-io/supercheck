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
 * - k6-{code}: Dynamic per-location queues, created from enabled locations in the database
 * - Each regional worker processes BOTH its regional queue AND the global queue
 */

// K6 global queue - processed by all regional workers for load balancing
export const K6_QUEUE = 'k6-global';

/** Build a K6 queue name from a location code */
export function k6QueueName(locationCode: string): string {
  return `k6-${locationCode}`;
}
