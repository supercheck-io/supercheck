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
const REPAIR_AFTER_MS = 60_000;
const RETENTION_SWEEP_MS = 10 * 60_000;
const DEFAULT_RETENTION_DAYS = 14;

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
 */
@Injectable()
export class MonitorCycleProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitorCycleProcessor.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> = Promise.resolve();
  private stopping = false;
  private lastRetentionAt = 0;
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
      this.running = this.tick().finally(() =>
        this.schedule(this.state.intervalMs),
      );
    }, delay);
  }

  /** One bounded pass. Exposed for tests; never throws. */
  async tick(now: Date = new Date()): Promise<void> {
    this.state.lastTickAt = now.getTime();
    try {
      await this.processArrivals(now);
      await this.processDeadlines(now);
      await this.repairNotifications(now);
      await this.sweepRetention(now);
      await this.refreshLag(now);
      this.state.lastSuccessAt = Date.now();
      this.state.consecutiveFailures = 0;
    } catch (error) {
      this.state.consecutiveFailures += 1;
      this.logger.error(
        `Cycle processing tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async processArrivals(now: Date): Promise<void> {
    const claimed = await this.dbService.db.execute<{ cycle_id: string }>(sql`
      UPDATE monitor_cycle_arrivals SET processed_at = ${now.toISOString()}::timestamp
      WHERE id IN (
        SELECT id FROM monitor_cycle_arrivals WHERE processed_at IS NULL
        ORDER BY created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED
      ) RETURNING cycle_id`);
    const ids = [...new Set(Array.from(claimed, (row) => row.cycle_id))];
    for (const id of ids) await this.close(id, now);
  }

  private async processDeadlines(now: Date): Promise<void> {
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
      .limit(BATCH);
    for (const { id } of due) await this.close(id, now);
  }

  private async repairNotifications(now: Date): Promise<void> {
    const pending = await this.dbService.db
      .select({ id: schema.monitorCycles.id })
      .from(schema.monitorCycles)
      .where(
        and(
          eq(schema.monitorCycles.status, 'closed'),
          isNull(schema.monitorCycles.notifiedAt),
          lte(
            schema.monitorCycles.closedAt,
            new Date(now.getTime() - REPAIR_AFTER_MS),
          ),
        ),
      )
      .orderBy(asc(schema.monitorCycles.closedAt))
      .limit(BATCH);
    for (const { id } of pending) await this.notify(id);
  }

  private async close(id: string, now: Date): Promise<void> {
    try {
      const outcome = await this.cycles.closeCycle(id, now);
      this.state.closed[outcome] = (this.state.closed[outcome] ?? 0) + 1;
      if (outcome === 'closed') await this.notify(id);
    } catch (error) {
      this.state.cycleFailures += 1;
      this.logger.error(
        `Closing cycle ${id} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async notify(id: string): Promise<void> {
    try {
      await this.cycles.notifyCycle(id);
    } catch (error) {
      // Left without a receipt on purpose: the repair pass retries (at-least-once).
      this.state.notifyFailures += 1;
      this.logger.error(
        `Notifying cycle ${id} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
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
    const deleted = await this.dbService.db.execute(sql`
      DELETE FROM monitor_cycles WHERE id IN (
        SELECT id FROM monitor_cycles
        WHERE closed_at IS NOT NULL AND closed_at < ${cutoff.toISOString()}::timestamp
        ORDER BY closed_at LIMIT 500
      )`);
    this.state.retentionDeleted += deleted.count ?? 0;
  }

  private async refreshLag(now: Date): Promise<void> {
    const [lag] = await this.dbService.db.execute<{
      arrival: Date | null;
      overdue: Date | null;
      unnotified: string;
    }>(sql`
      SELECT
        (SELECT min(created_at) FROM monitor_cycle_arrivals WHERE processed_at IS NULL) AS arrival,
        (SELECT min(deadline_at) FROM monitor_cycles WHERE status = 'open' AND deadline_at <= ${now.toISOString()}::timestamp) AS overdue,
        (SELECT count(*) FROM monitor_cycles WHERE status = 'closed' AND notified_at IS NULL) AS unnotified`);
    const seconds = (value: Date | null) =>
      value
        ? Math.max(0, (now.getTime() - new Date(value).getTime()) / 1000)
        : 0;
    this.state.arrivalLagSeconds = seconds(lag.arrival);
    this.state.overdueSeconds = seconds(lag.overdue);
    this.state.unnotifiedClosed = Number(lag.unnotified);
  }
}
