import { Logger } from '@nestjs/common';
import type { Worker } from 'bullmq';
import {
  type LocationWorkload,
  workerLocationAllowsWorkload,
} from './location-capability';

interface GuardDb {
  db: { execute: (query: never) => Promise<unknown> };
}

export const GLOBAL_QUEUE_GUARD_INTERVAL_MS = 15_000;

/**
 * The global Playwright and k6 queues have no location of their own, so the
 * capability of the location that CONSUMES them decides whether they may run
 * there. This pauses the global consumer while the worker's own location has the
 * capability turned off, and resumes it when it is turned back on. Jobs stay
 * queued for a capable worker; nothing is failed or moved.
 *
 * Failure semantics (there is no per-job backstop for global jobs):
 * - Only an explicit `false` pauses; a missing location row or a database that
 *   predates the capability columns keeps today's behaviour.
 * - On a DB error the consumer keeps its current state: a database blip must
 *   not pause every worker, but a capability change is then not applied until
 *   the next successful check (every 15 seconds).
 * - A job already running when the check pauses the consumer finishes, and a
 *   change takes up to one interval to apply.
 * - k6 jobs pinned to a regional queue are additionally checked per job in
 *   K6ExecutionProcessor.handleProcess; global Playwright and global k6 jobs
 *   are not.
 */
export class GlobalQueueCapabilityGuard {
  private timer: ReturnType<typeof setInterval> | null = null;
  private paused = false;
  private stopped = false;

  constructor(
    private readonly getWorker: () => Worker | undefined,
    private readonly dbService: unknown,
    private readonly location: string,
    private readonly workload: LocationWorkload,
    private readonly logger: Logger,
    private readonly intervalMs = GLOBAL_QUEUE_GUARD_INTERVAL_MS,
  ) {}

  start(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async check(): Promise<void> {
    if (this.stopped) return;
    const worker = this.getWorker();
    if (!worker) return;
    try {
      const allowed = await workerLocationAllowsWorkload(
        this.dbService as GuardDb,
        this.location,
        this.workload,
      );
      if (this.stopped) return;
      if (!allowed && !this.paused) {
        await worker.pause(true);
        // Only after success: a failed pause must be retried by the next check.
        this.paused = true;
        this.logger.warn(
          `Location "${this.location}" does not support ${this.workload} execution; paused its global queue consumer`,
        );
      } else if (allowed && this.paused) {
        worker.resume();
        this.paused = false;
        this.logger.log(
          `Location "${this.location}" supports ${this.workload} execution again; resumed its global queue consumer`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Could not verify ${this.workload} capability for "${this.location}"; keeping consumer state: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
