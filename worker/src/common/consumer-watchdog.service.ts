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
/** A busy Redis can stall a PING for several seconds; only this many timed-out probes in a row mean a dead socket. */
const PING_MISSES_BEFORE_KICK = 3;

class ProbeTimeoutError extends Error {}

function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new ProbeTimeoutError(`${what} timed out`)),
        PING_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Detects a BullMQ consumer that silently stopped pulling jobs after a Redis or Sentinel failover.
 * Two failures leave a worker Ready and quiet. (1) The blocking connection ends for good: BullMQ's
 * block-timeout guard calls `disconnect(true)` on it while ioredis is still resolving a master through
 * unreachable Sentinels, the connector aborts, and ioredis sets status `end` without a retry; the main
 * loop then waits on a dead client forever. An `end` client is revived with `connect()`. (2) The command
 * connection stays `ready` on a half-open socket: no reply, no error and no reconnect. Each probe PINGs every distinct command
 * connection; one whose PING times out on PING_MISSES_BEFORE_KICK probes in a row while `ready` is
 * forced to reconnect (ioredis resends the pending commands). Any reply, even an error, counts as alive
 * and resets that count, so a slow but live Redis is not kicked. That kick also runs while draining or paused, because in-flight jobs still need
 * the connection to finish. A consumer reports unhealthy while its connection is unresponsive, ended,
 * or its run loop exited, and liveness fails once that has lasted DEAD_AFTER_MS without a successful
 * ping in between. A connection that is reconnecting resets the clock: ioredis is already retrying,
 * so a long Redis outage alone never restarts the pod.
 */
@Injectable()
export class ConsumerWatchdogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConsumerWatchdogService.name);
  private timer: NodeJS.Timeout | null = null;
  private probing = false;
  private readonly brokenSince = new Map<Worker, number>();
  // Consecutive timed-out PINGs per client; a reply or leaving `ready` resets it.
  private readonly pingMisses = new WeakMap<Redis, number>();

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.probe().catch((error) =>
        this.logger.error(
          `consumer probe failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }, PROBE_INTERVAL_MS);
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

      // A client shared by several workers (dynamic monitor/k6) is probed and kicked once.
      // A client promise still pending (pod started while Redis is down) is `reconnecting`, not broken.
      const clients = new Map<Worker, Redis | null>();
      const connecting = new Set<Worker>();
      await Promise.all(
        [...live].map(async (worker) => {
          try {
            const client = (await withTimeout(
              worker.client,
              'Redis client init',
            )) as unknown as Redis;
            clients.set(worker, client);
          } catch (error) {
            clients.set(worker, null);
            if (error instanceof ProbeTimeoutError) connecting.add(worker);
          }
        }),
      );
      const state = new Map<Redis, 'ok' | 'unresponsive' | 'reconnecting'>();
      await Promise.all(
        [...new Set(clients.values())].map(async (client) => {
          if (!client) return;
          // An ended client is only revived while it is still wanted: not during shutdown.
          const reviveOk =
            !isDraining() &&
            ![...live].some(
              (w) => clients.get(w) === client && Boolean(w.closing),
            );
          state.set(client, await this.pingClient(client, reviveOk));
        }),
      );

      // Never PING the blocking client: the PING would queue behind the blocked BZPOPMIN.
      const blockingEnded = new Set<Worker>();
      await Promise.all(
        [...live].map(async (worker) => {
          if (!worker.closing && (await this.reviveIfEnded(worker)))
            blockingEnded.add(worker);
        }),
      );

      const counted = !isDraining();
      for (const worker of live) {
        const client = clients.get(worker) ?? null;
        let status = client
          ? state.get(client)
          : connecting.has(worker)
            ? 'reconnecting'
            : 'unresponsive';
        if (blockingEnded.has(worker)) status = 'unresponsive';
        // Draining, paused and closing consumers are stopped on purpose; the kick above still ran.
        if (!counted || worker.closing || worker.isPaused()) {
          this.brokenSince.delete(worker);
        } else if (!worker.isRunning()) {
          this.markBroken(worker, now, 'run loop is not running');
        } else if (status === 'unresponsive' || status === undefined) {
          this.markBroken(worker, now, 'Redis connection unresponsive');
        } else if (status === 'ok') {
          this.brokenSince.delete(worker);
        } else {
          // reconnecting: ioredis is working on it, so a long Redis outage alone never fails liveness
          // (restarting would not help); the clock starts again only if the connection ends or hangs.
          this.brokenSince.delete(worker);
        }
      }
    } finally {
      this.probing = false;
    }
  }

  /** True when the worker's blocking client had ended (it is revived here). */
  private async reviveIfEnded(worker: Worker): Promise<boolean> {
    try {
      const blocking = (
        worker as unknown as {
          blockingConnection?: { client: Promise<Redis> };
        }
      ).blockingConnection;
      if (!blocking) return false;
      const client = await withTimeout(blocking.client, 'blocking client init');
      if (client.status !== 'end') return false;
      if (isDraining()) return true;
      this.logger.warn(
        `[${worker.name}] blocking Redis connection ended; reconnecting`,
      );
      client.connect().catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  private markBroken(worker: Worker, now: number, problem: string): void {
    if (this.brokenSince.has(worker)) return;
    this.brokenSince.set(worker, now);
    this.logger.warn(`[${worker.name}] consumer unhealthy: ${problem}`);
  }

  private async pingClient(
    client: Redis,
    reviveOk: boolean,
  ): Promise<'ok' | 'unresponsive' | 'reconnecting'> {
    if (client.status === 'end') {
      if (reviveOk) client.connect().catch(() => undefined);
      return 'unresponsive';
    }
    if (client.status !== 'ready') {
      this.pingMisses.delete(client);
      return 'reconnecting';
    }
    try {
      await withTimeout(client.ping(), 'PING');
      this.pingMisses.delete(client);
      return 'ok';
    } catch (error) {
      // Any reply (even an error such as LOADING) proves the socket is alive.
      if (!(error instanceof ProbeTimeoutError)) {
        this.pingMisses.delete(client);
        return 'ok';
      }
      // Only a still-ready socket is kicked: disconnecting a client that meanwhile started connecting
      // through Sentinel aborts its connector and ends it for good (the failure this service guards).
      if (client.status !== 'ready') {
        this.pingMisses.delete(client);
        return 'reconnecting';
      }
      const misses = (this.pingMisses.get(client) ?? 0) + 1;
      if (misses < PING_MISSES_BEFORE_KICK) {
        this.pingMisses.set(client, misses);
        return 'unresponsive';
      }
      this.pingMisses.delete(client);
      this.logger.warn(
        `Redis PING timed out on ${misses} probes in a row; forcing reconnect`,
      );
      client.disconnect(true);
      return 'unresponsive';
    }
  }
}
