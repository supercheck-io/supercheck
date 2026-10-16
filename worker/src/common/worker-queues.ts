/**
 * Worker queue-consumer selection.
 *
 * WORKER_QUEUES controls which queue consumers a worker deployment starts. It is
 * independent of the per-location capabilities in the DB (what users may run) and
 * of Kubernetes execution placement (where execution pods run).
 *
 * Tokens:
 * - monitor:           regional `monitor-<location>` queues (HTTP/ping/port/SSL and
 *                      synthetic monitors, which execute directly from this worker)
 * - k6:                regional `k6-<location>` queues (only k6-capable locations)
 * - global-playwright: the location-less `playwright-global` queue (tests and CI jobs)
 * - global-k6:         the location-less `k6-global` queue
 *
 * When unset or empty, every consumer starts (backward compatible with installs
 * that predate this setting). An unknown token is a startup error so a typo can
 * never silently disable or enable work.
 *
 * Set this as a real environment variable (not only in .env): the global
 * @Processor consumers read it when their module is evaluated, before
 * ConfigModule has loaded .env.
 */
import { isCloudWorkerRuntime } from './runtime-mode';

export const WORKER_QUEUE_TOKENS = [
  'monitor',
  'k6',
  'global-playwright',
  'global-k6',
] as const;

export type WorkerQueueToken = (typeof WORKER_QUEUE_TOKENS)[number];

export function parseWorkerQueues(
  raw: string | undefined | null,
): Set<WorkerQueueToken> {
  const value = raw?.trim();
  if (!value) {
    if (isCloudWorkerRuntime()) {
      throw new Error(
        `WORKER_QUEUES must be set explicitly in cloud production (allowed: ${WORKER_QUEUE_TOKENS.join(', ')})`,
      );
    }
    return new Set(WORKER_QUEUE_TOKENS);
  }

  const tokens = value
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  const unknown = tokens.filter(
    (token) => !(WORKER_QUEUE_TOKENS as readonly string[]).includes(token),
  );
  if (unknown.length > 0 || tokens.length === 0) {
    throw new Error(
      `Invalid WORKER_QUEUES "${raw}". Unknown token(s): ${unknown.join(', ') || '(none)'}. ` +
        `Allowed: ${WORKER_QUEUE_TOKENS.join(', ')}`,
    );
  }
  return new Set(tokens as WorkerQueueToken[]);
}

let frozen: {
  raw: string | undefined;
  tokens: Set<WorkerQueueToken>;
} | null = null;
let warnedChanged = false;

/** Test hook: forget the value captured by the first read. */
export function resetWorkerQueuesForTests(): void {
  frozen = null;
  warnedChanged = false;
}

/**
 * True when this worker should start the consumer for the given token.
 *
 * The first read is frozen so the @Processor decorators (evaluated at import,
 * before .env loads) and the runtime services always agree. If the environment
 * changes afterwards, a warning explains that a restart is required.
 */
export function consumesWorkerQueue(token: WorkerQueueToken): boolean {
  const raw = process.env.WORKER_QUEUES;
  if (!frozen) {
    frozen = { raw, tokens: parseWorkerQueues(raw) };
  } else if (frozen.raw !== raw && !warnedChanged) {
    warnedChanged = true;
    console.warn(
      `WORKER_QUEUES changed after startup ("${frozen.raw ?? ''}" -> "${raw ?? ''}"); ` +
        'the startup value stays in effect until the worker restarts. ' +
        'Set WORKER_QUEUES as a real environment variable, not only in .env.',
    );
  }
  return frozen.tokens.has(token);
}
