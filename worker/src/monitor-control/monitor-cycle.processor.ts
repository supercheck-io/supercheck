import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import * as schema from '../db/schema';
import { MonitorCycleService } from './monitor-cycle.service';

const BATCH = 50;
/** One minute of repair grace per failed delivery attempt (also covers an in-flight first delivery). */
const REPAIR_GRACE_SECONDS = 60;
const RETENTION_SWEEP_MS = 10 * 60_000;
const RETENTION_BATCH = 500;
const RETENTION_MAX_BATCHES = 20;
const DEFAULT_RETENTION_DAYS = 14;
const POISON_MAX_BACKOFF_MS = 5 * 60_000;
/** After this many failed closures (about 1.5 h at the maximum backoff) the cycle is aborted. */
const POISON_GIVE_UP_AFTER = 20;
/**
 * Wall-clock budget for one notification. A tenant-controlled endpoint that trickles a response must
 * not stall every other organization's closures and alerts behind it.
 */
const DEFAULT_NOTIFY_BUDGET_MS = 45_000;

function notifyBudgetMs(): number {
  const raw = Number.parseInt(
    process.env.MISSING_CYCLE_NOTIFY_BUDGET_MS ?? '',
    10,
  );
  return Math.min(
    120_000,
    Math.max(500, Number.isFinite(raw) ? raw : DEFAULT_NOTIFY_BUDGET_MS),
  );
}

/** Drizzle wraps driver errors; the cause (connection, TLS, SQLSTATE) is what operators need. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause =
    error.cause instanceof Error ? ` (cause: ${error.cause.message})` : '';
  return `${error.message.split('\n')[0]}${cause}`;
}

export type ProcessorSnapshot = {
  started: boolean;
  intervalMs: number;
  lastTickAt: number | null;
  lastSuccessAt: number | null;
  consecutiveFailures: number;
  arrivalLagSeconds: number;
  overdueSeconds: number;
  unnotifiedClosed: number;
  closed: Record<string, number>;
  notifyFailures: number;
  cycleFailures: number;
  retentionDeleted: number;
};

/**
 * Polls three bounded partial indexes (pending arrival hints, overdue open cycles, closed cycles
 * without a delivery receipt). No startup sweep: nothing scans monitors or results. Cycles are
 * processed one at a time, which keeps the database connection budget at a handful of connections.
 * An arrival hint is claimed BEFORE results are read, so a re-armed hint written meanwhile is
 * never lost; a lost hint only delays closure to the deadline.
 *
 * Run a single replica: closure is idempotent under row locks, but two replicas could both repair
 * the same undelivered notification (at-least-once delivery).
 */
@Injectable()
export class MonitorCycleProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitorCycleProcessor.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> = Promise.resolve();
  private stopping = false;
  private lastRetentionAt = 0;
  /** Closed this tick; notified only after every due cycle has been closed. */
  private toNotify: string[] = [];
  /** Cycles whose closure keeps throwing: skipped with backoff so they cannot starve a batch. */
  private readonly failing = new Map<
    string,
    { failures: number; nextAt: number }
  >();
  private readonly state: ProcessorSnapshot = {
    started: false,
    intervalMs: this.pollInterval(),
    lastTickAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    arrivalLagSeconds: 0,
    overdueSeconds: 0,
    unnotifiedClosed: 0,
    closed: {},
    notifyFailures: 0,
    cycleFailures: 0,
    retentionDeleted: 0,
  };

  constructor(
    private readonly dbService: DbService,
    private readonly cycles: MonitorCycleService,
  ) {}

  onModuleInit(): void {
    this.state.started = true;
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running; // let an in-flight cycle finish its transaction
  }

  snapshot(): ProcessorSnapshot {
    return { ...this.state, closed: { ...this.state.closed } };
  }

  private pollInterval(): number {
    const raw = Number.parseInt(process.env.MISSING_CYCLE_POLL_MS ?? '', 10);
    return Math.min(30_000, Math.max(500, Number.isFinite(raw) ? raw : 2000));
  }

  private schedule(delay: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.running = this.tick().then((more) =>
        this.schedule(more ? 0 : this.state.intervalMs),
      );
    }, delay);
  }

  /**
   * One bounded pass. Exposed for tests; never throws. Returns true when a full batch suggests
   * more work is waiting, so the next pass starts immediately instead of after the poll interval.
   */
  async tick(now: Date = new Date()): Promise<boolean> {
    this.state.lastTickAt = now.getTime();
    let more = false;
    try {
      const arrivals = await this.processArrivals(now);
      const deadlines = await this.processDeadlines(now);
      await this.flushNotifications();
      await this.repairNotifications(now);
      await this.sweepRetention(now);
      await this.refreshLag(now);
      more = arrivals >= BATCH || deadlines >= BATCH;
      this.beat();
      this.state.consecutiveFailures = 0;
    } catch (error) {
      this.state.consecutiveFailures += 1;
      this.logger.error(
        `Cycle processing tick failed: ${describeError(error)}`,
      );
    }
    return more;
  }

  /** Progress heartbeat: a long tick (slow webhooks) must not look like a stalled loop. */
  private beat(): void {
    this.state.lastSuccessAt = Date.now();
  }

  private async processArrivals(now: Date): Promise<number> {
    const claimed = await this.dbService.db.execute<{ cycle_id: string }>(sql`
      UPDATE monitor_cycle_arrivals SET processed_at = ${now.toISOString()}::timestamp
      WHERE id IN (
        SELECT id FROM monitor_cycle_arrivals WHERE processed_at IS NULL
        ORDER BY created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED
      ) RETURNING cycle_id`);
    const ids = [...new Set(Array.from(claimed, (row) => row.cycle_id))];
    for (const id of ids) {
      if (this.stopping) break;
      await this.close(id, now);
    }
    return claimed.length;
  }

  private async processDeadlines(now: Date): Promise<number> {
    // Fetch extra rows so cycles in backoff never crowd out healthy ones.
    const due = await this.dbService.db
      .select({ id: schema.monitorCycles.id })
      .from(schema.monitorCycles)
      .where(
        and(
          eq(schema.monitorCycles.status, 'open'),
          lte(schema.monitorCycles.deadlineAt, now),
        ),
      )
      .orderBy(asc(schema.monitorCycles.deadlineAt))
      .limit(BATCH + this.failing.size);
    if (due.length < BATCH + this.failing.size) {
      // The query saw every open overdue cycle: forget entries that were closed, deleted or aborted.
      const seen = new Set(due.map((row) => row.id));
      for (const id of this.failing.keys())
        if (!seen.has(id)) this.failing.delete(id);
    }
    let processed = 0;
    for (const { id } of due) {
      if (this.stopping || processed >= BATCH) break;
      if ((this.failing.get(id)?.nextAt ?? 0) > Date.now()) continue;
      processed += 1;
      await this.close(id, now);
    }
    return processed;
  }

  private async repairNotifications(now: Date): Promise<void> {
    const pending = await this.dbService.db
      .select({ id: schema.monitorCycles.id })
      .from(schema.monitorCycles)
      .where(
        and(
          eq(schema.monitorCycles.status, 'closed'),
          isNull(schema.monitorCycles.notifiedAt),
          sql`${schema.monitorCycles.closedAt} + (${schema.monitorCycles.notifyAttempts} + 1) * ${REPAIR_GRACE_SECONDS} * interval '1 second' <= ${now.toISOString()}::timestamp`,
        ),
      )
      .orderBy(asc(schema.monitorCycles.closedAt))
      .limit(BATCH);
    for (const { id } of pending) {
      if (this.stopping) break;
      await this.notify(id);
    }
  }

  private async close(id: string, now: Date): Promise<void> {
    try {
      const outcome = await this.cycles.closeCycle(id, now);
      this.failing.delete(id);
      this.state.closed[outcome] = (this.state.closed[outcome] ?? 0) + 1;
      if (outcome === 'closed') this.toNotify.push(id);
    } catch (error) {
      this.state.cycleFailures += 1;
      const failures = (this.failing.get(id)?.failures ?? 0) + 1;
      this.failing.set(id, {
        failures,
        nextAt:
          Date.now() + Math.min(POISON_MAX_BACKOFF_MS, 2000 * 2 ** failures),
      });
      this.logger.error(
        `Closing cycle ${id} failed (attempt ${failures}): ${describeError(error)}`,
      );
      if (failures >= POISON_GIVE_UP_AFTER) {
        this.failing.delete(id);
        await this.cycles.abortCycle(id).catch(() => undefined);
        this.logger.error(
          `Aborted cycle ${id} after ${failures} failed closures; investigate the cause above`,
        );
      }
    } finally {
      this.beat();
    }
  }

  private async flushNotifications(): Promise<void> {
    const ids = this.toNotify;
    this.toNotify = [];
    for (const id of ids) {
      if (this.stopping) break;
      await this.notify(id);
    }
  }

  private async notify(id: string): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.cycles.notifyCycle(id),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error(`notification exceeded ${notifyBudgetMs()} ms`)),
            notifyBudgetMs(),
          );
        }),
      ]);
    } catch (error) {
      // No receipt: the repair pass retries with backoff, and each failure counts as an attempt
      // (bounded), so a hanging or throwing delivery cannot loop on every tick.
      this.state.notifyFailures += 1;
      this.logger.error(
        `Notifying cycle ${id} failed: ${describeError(error)}`,
      );
      await this.cycles.recordNotifyFailure(id).catch(() => undefined);
    } finally {
      if (timer) clearTimeout(timer);
      this.beat();
    }
  }

  private async sweepRetention(now: Date): Promise<void> {
    if (now.getTime() - this.lastRetentionAt < RETENTION_SWEEP_MS) return;
    this.lastRetentionAt = now.getTime();
    const days = Number.parseInt(
      process.env.MISSING_CYCLE_RETENTION_DAYS ?? '',
      10,
    );
    const cutoff = new Date(
      now.getTime() -
        (Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS) *
          86_400_000,
    );
    // Catch up in bounded batches: one cycle exists per scheduled check, so a single small delete
    // per sweep would never keep pace on a busy installation.
    for (
      let batch = 0;
      batch < RETENTION_MAX_BATCHES && !this.stopping;
      batch++
    ) {
      const deleted = await this.dbService.db.execute(sql`
        DELETE FROM monitor_cycles WHERE id IN (
          SELECT id FROM monitor_cycles
          WHERE closed_at IS NOT NULL AND closed_at < ${cutoff.toISOString()}::timestamp
          ORDER BY closed_at LIMIT ${RETENTION_BATCH}
        )`);
      this.state.retentionDeleted += deleted.count ?? 0;
      if ((deleted.count ?? 0) < RETENTION_BATCH) break;
    }
  }

  private async refreshLag(now: Date): Promise<void> {
    // Computed in SQL: the driver returns timestamp-without-time-zone values that Node would
    // otherwise parse in its local zone.
    const at = now.toISOString();
    const [lag] = await this.dbService.db.execute<{
      arrival: string | null;
      overdue: string | null;
      unnotified: string;
    }>(sql`
      SELECT
        (SELECT EXTRACT(EPOCH FROM (${at}::timestamp - min(created_at))) FROM monitor_cycle_arrivals WHERE processed_at IS NULL) AS arrival,
        (SELECT EXTRACT(EPOCH FROM (${at}::timestamp - min(deadline_at))) FROM monitor_cycles WHERE status = 'open' AND deadline_at <= ${at}::timestamp) AS overdue,
        (SELECT count(*) FROM monitor_cycles WHERE status = 'closed' AND notified_at IS NULL) AS unnotified`);
    this.state.arrivalLagSeconds = Math.max(0, Number(lag.arrival ?? 0));
    this.state.overdueSeconds = Math.max(0, Number(lag.overdue ?? 0));
    this.state.unnotifiedClosed = Number(lag.unnotified);
  }
}
