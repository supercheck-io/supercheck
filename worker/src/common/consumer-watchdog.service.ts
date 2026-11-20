import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Worker } from 'bullmq';
import type Redis from 'ioredis';
import { isDraining } from './shutdown-intake';

type WorkerGetter = () => Iterable<Worker | null | undefined>;

const consumers = new Set<WorkerGetter>();

/** Registers a BullMQ consumer whose liveness the watchdog checks. Returns an unregister function. */
export function registerConsumer(get: WorkerGetter): () => void {
  consumers.add(get);
  return () => consumers.delete(get);
}

const PROBE_INTERVAL_MS = 15_000;
const PING_TIMEOUT_MS = 5_000;
/** A consumer that stays broken this long cannot recover by itself: liveness fails so Kubernetes restarts the pod. */
const DEAD_AFTER_MS = 5 * 60_000;

function pingWithTimeout(client: {
  ping: () => Promise<unknown>;
}): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    client.ping().then(() => undefined),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('PING timed out')),
        PING_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Detects a BullMQ consumer that silently stopped pulling jobs after a Redis or Sentinel failover.
 * The command connection a Worker shares can stay `ready` on a half-open socket: no reply, no error and
 * no reconnect, so the queue fills with nothing active. Each probe PINGs that connection; a failed
 * ping on a `ready` connection forces a reconnect (ioredis resends the pending commands). A consumer
 * whose connection has ended, whose run loop exited, or that keeps failing for DEAD_AFTER_MS reports
 * unhealthy. A connection that is merely reconnecting is left alone: it resumes when Redis returns.
 */
@Injectable()
export class ConsumerWatchdogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConsumerWatchdogService.name);
  private timer: NodeJS.Timeout | null = null;
  private probing = false;
  private readonly brokenSince = new Map<Worker, number>();

  onModuleInit(): void {
    this.timer = setInterval(() => void this.probe(), PROBE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** False once any consumer has been broken for DEAD_AFTER_MS. */
  isHealthy(now = Date.now()): boolean {
    if (isDraining()) return true;
    for (const since of this.brokenSince.values()) {
      if (now - since >= DEAD_AFTER_MS) return false;
    }
    return true;
  }

  async probe(now = Date.now()): Promise<void> {
    if (this.probing) return;
    this.probing = true;
    try {
      const live = new Set<Worker>();
      for (const get of consumers) {
        for (const worker of get()) if (worker) live.add(worker);
      }
      for (const known of this.brokenSince.keys()) {
        if (!live.has(known)) this.brokenSince.delete(known);
      }
      if (isDraining()) return this.brokenSince.clear();
      await Promise.all(
        [...live].map(async (worker) => {
          const problem = await this.check(worker);
          if (!problem) return void this.brokenSince.delete(worker);
          if (!this.brokenSince.has(worker)) {
            this.brokenSince.set(worker, now);
            this.logger.warn(`[${worker.name}] consumer unhealthy: ${problem}`);
          }
        }),
      );
    } finally {
      this.probing = false;
    }
  }

  /** Returns why the consumer is broken, or null when it is fine or intentionally stopped. */
  private async check(worker: Worker): Promise<string | null> {
    if (worker.closing || worker.isPaused()) return null;
    if (!worker.isRunning()) return 'run loop is not running';
    try {
      const client = (await worker.client) as unknown as Redis;
      if (client.status === 'end') return 'Redis connection ended';
      if (client.status !== 'ready') return null; // ioredis is reconnecting by itself
      try {
        await pingWithTimeout(client);
        return null;
      } catch (error) {
        this.logger.warn(
          `[${worker.name}] Redis ping failed on a ready connection (${error instanceof Error ? error.message : String(error)}); forcing reconnect`,
        );
        client.disconnect(true);
        return 'Redis connection unresponsive';
      }
    } catch (error) {
      return `Redis client unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
