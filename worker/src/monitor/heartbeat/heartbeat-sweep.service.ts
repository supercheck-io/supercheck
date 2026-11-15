import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import * as schema from '../../db/schema';
import { RedisService } from '../../execution/services/redis.service';
import { UsageTrackerService } from '../../execution/services/usage-tracker.service';
import { getErrorMessage } from '../../common/validation';
import { MonitorService } from '../monitor.service';
import { MonitorAlertService } from '../services/monitor-alert.service';
import type { MonitorExecutionResult } from '../types/monitor-result.type';

/** Written by the app's 60 s tick (app/src/lib/sre/incident-renotify.ts, EX 150): the ping route is alive. */
export const HEARTBEAT_INGEST_KEY = 'supercheck:heartbeat:ingest';
export const INGEST_DOWN_SINCE_KEY = 'supercheck:heartbeat:ingest-down-since';
export const INGEST_OUTAGE_KEY = 'supercheck:heartbeat:ingest-outage';
/** The stamp's expiry: the app may have stopped this long before the key disappeared. */
const INGEST_STAMP_TTL_MS = 150_000;
const REDIS_TIMEOUT_MS = 2_000;
export const HEARTBEAT_SWEEP_INTERVAL_MS = 30_000;
/**
 * Atomically turns a recorded ingest outage start (KEYS[1]) into the outage window (KEYS[2]) ending at ARGV[1], and
 * returns {1 if this call closed it else 0, the current window or ''}. The window lives until every deadline it
 * can move has passed (3 x its length + 1 h).
 */
export const CLOSE_OUTAGE_SCRIPT = `
local since = redis.call('GET', KEYS[1])
if since then
  local window = '{"id":"' .. since .. '","startMs":' .. since .. ',"endMs":' .. ARGV[1] .. '}'
  redis.call('SET', KEYS[2], window, 'EX', math.ceil(3 * (tonumber(ARGV[1]) - tonumber(since)) / 1000) + 3600)
  redis.call('DEL', KEYS[1])
  return {1, window}
end
return {0, redis.call('GET', KEYS[2]) or ''}`;
export const CLAIM_LIMIT = 100;
const SWEEP_BUDGET_MS = 20_000;
const EVALUATION_CONCURRENCY = 10;

type HeartbeatMonitor = typeof schema.monitors.$inferSelect;

export type IngestOutage = { id: string; startMs: number; endMs: number };
/** `up` false: the stamp is missing or Redis cannot be read, so no miss or late detection. */
export type IngestStatus = { up: boolean; outage?: IngestOutage };

export type HeartbeatFinish = {
  evaluatedSeq?: number;
  evaluatedFailSeq?: number;
  lastMissedAt?: string;
  lateEpisodeKey?: string;
  deadlineShiftedFor?: string;
  deadlineShiftMs?: number;
  /** A new ping ends the late episode and any deadline shift. */
  newPing?: boolean;
};

export type HeartbeatDecision = {
  result?: {
    kind: 'ping' | 'fail' | 'missed';
    isUp: boolean;
    checkedAt: Date;
    responseTimeMs?: number;
    reason: string;
  };
  /** A /fail followed by a success ping in one sweep window: recorded as down (at this time) before the ping. */
  priorFailAt?: Date;
  /** Episode key of a late warning to send. */
  lateEpisodeKey?: string;
  finish: HeartbeatFinish;
};

const DAY_MS = 24 * 60 * 60_000;
const FAIL_REASON = 'Job reported failure';

const MINUTE_MS = 60_000;

function toMs(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Mirror of app/src/lib/heartbeat/state.ts defaultHeartbeatGraceMinutes / heartbeatGraceMinutes. */
export function heartbeatGraceMinutes(
  monitor: Pick<HeartbeatMonitor, 'frequencyMinutes' | 'config'>,
): number {
  return (
    monitor.config?.heartbeat?.graceMinutes ??
    Math.min(1440, Math.max(5, Math.round(monitor.frequencyMinutes * 0.2)))
  );
}

function formatMinutes(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} d`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

/**
 * What one sweep does with one claimed heartbeat monitor (spec 4.4), from its state snapshot alone.
 * `now` is database time, the clock the ping route stamps pings with.
 */
export function decideHeartbeat(
  monitor: Pick<
    HeartbeatMonitor,
    | 'id'
    | 'status'
    | 'frequencyMinutes'
    | 'config'
    | 'heartbeatState'
    | 'createdAt'
  >,
  now: number,
  ingest: IngestStatus,
): HeartbeatDecision {
  const state = monitor.heartbeatState ?? {};
  const pingSeq = state.pingSeq ?? 0;
  const lastPingAt = toMs(state.lastPingAt);
  const intervalMs = monitor.frequencyMinutes * MINUTE_MS;
  const graceMinutes = heartbeatGraceMinutes(monitor);

  // A ping or /fail not judged yet. Pings land even while the app ingest guard is unsure.
  if (lastPingAt !== null && pingSeq > (state.evaluatedSeq ?? 0)) {
    const failSeq = state.failSeq ?? 0;
    const finish: HeartbeatFinish = {
      evaluatedSeq: pingSeq,
      newPing: true,
      ...(state.failSeq !== undefined ? { evaluatedFailSeq: failSeq } : {}),
    };
    if (state.lastPingKind === 'fail') {
      return {
        result: {
          kind: 'fail',
          isUp: false,
          checkedAt: new Date(lastPingAt),
          reason: FAIL_REASON,
        },
        finish,
      };
    }
    // A /fail the newest ping overtook within one sweep window still counts as a failure.
    const lastFailAt = toMs(state.lastFailAt);
    const priorFailAt =
      failSeq > (state.evaluatedFailSeq ?? 0) && lastFailAt !== null
        ? new Date(lastFailAt)
        : undefined;
    // shortcut: the state keeps only the newest /start, so it counts only within one interval before the
    // ping; a run longer than its interval (or a stale /start) shows no duration. Track per-run starts to lift it.
    const startedAt = toMs(state.lastStartAt);
    const duration =
      startedAt !== null &&
      startedAt <= lastPingAt &&
      lastPingAt - startedAt <= intervalMs
        ? lastPingAt - startedAt
        : undefined;
    return {
      result: {
        kind: 'ping',
        isUp: true,
        checkedAt: new Date(lastPingAt),
        responseTimeMs: duration,
        reason: 'Ping received',
      },
      ...(priorFailAt ? { priorFailAt } : {}),
      finish,
    };
  }

  // Never pinged: stays pending. App not ingesting: a missing ping proves nothing.
  if (lastPingAt === null || !ingest.up) return { finish: {} };

  const anchor =
    toMs(state.anchorAt) ?? toMs(monitor.createdAt) ?? Number.NEGATIVE_INFINITY;
  const last = Math.max(lastPingAt, anchor);
  const finish: HeartbeatFinish = {};
  let shift = state.deadlineShiftMs ?? 0;
  const outage = ingest.outage;
  if (outage && state.deadlineShiftedFor !== outage.id) {
    // The ping was due by the end of the app outage (it may have been swallowed) and the deadline had not passed
    // before the outage began: wait one more interval after the outage, at most 24 h, then grace; once per outage.
    // A ping, create or resume after the outage, or a heartbeat not yet due (a 31-day one), is not affected.
    const dueAt = last + intervalMs + shift;
    const deadline = dueAt + graceMinutes * MINUTE_MS;
    if (dueAt <= outage.endMs && deadline >= outage.startMs) {
      // lateAt = last + interval + shift = outageEnd + min(interval, 24 h)
      shift = Math.max(
        shift,
        outage.endMs + Math.min(intervalMs, DAY_MS) - last - intervalMs,
      );
      finish.deadlineShiftedFor = outage.id;
      finish.deadlineShiftMs = shift;
    }
  }
  const lateAt = last + intervalMs + shift;
  const deadline = lateAt + graceMinutes * MINUTE_MS;

  if (now > deadline) {
    const lastMissedAt = toMs(state.lastMissedAt);
    // One missed row per interval.
    if (lastMissedAt !== null && now - lastMissedAt < intervalMs)
      return { finish };
    finish.lastMissedAt = new Date(now).toISOString();
    return {
      result: {
        kind: 'missed',
        isUp: false,
        checkedAt: new Date(now),
        reason: `No ping received within ${formatMinutes(monitor.frequencyMinutes)} plus ${formatMinutes(graceMinutes)} grace`,
      },
      finish,
    };
  }
  // Best effort: the episode is marked even when no channel accepted the warning, so it is not retried within it.
  if (now > lateAt && monitor.status === 'up' && !state.lateEpisodeKey) {
    const lateEpisodeKey = `heartbeat_late:${monitor.id}:${new Date(deadline).toISOString()}`;
    finish.lateEpisodeKey = lateEpisodeKey;
    return { lateEpisodeKey, finish };
  }
  return { finish };
}

/**
 * Judges heartbeat monitors every 30 s in every main worker process (spec 4.4). A short claim statement leases up
 * to 100 monitors (FOR UPDATE SKIP LOCKED), each is evaluated with no lock or transaction held, and one finishing
 * UPDATE per monitor advances its state from the row's current value, so a ping landing meanwhile is never lost.
 */
@Injectable()
export class HeartbeatSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatSweepService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly dbService: DbService,
    private readonly redisService: RedisService,
    private readonly usageTrackerService: UsageTrackerService,
    private readonly monitorService: MonitorService,
    private readonly monitorAlertService: MonitorAlertService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => void this.sweep(),
      HEARTBEAT_SWEEP_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One sweep; overlapping ticks are skipped. Never throws. */
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const ingest = await this.readIngest();
      const started = Date.now();
      let full: boolean;
      // A full batch means more are due: keep going for most of the tick, so no monitor starves behind others.
      do {
        const { rows, now } = await this.claim(ingest.up);
        for (let i = 0; i < rows.length; i += EVALUATION_CONCURRENCY) {
          await Promise.all(
            rows
              .slice(i, i + EVALUATION_CONCURRENCY)
              .map((monitor) => this.evaluate(monitor, now, ingest)),
          );
        }
        full = rows.length === CLAIM_LIMIT;
      } while (full && Date.now() - started < SWEEP_BUDGET_MS);
    } catch (error) {
      this.logger.error(`Heartbeat sweep failed: ${getErrorMessage(error)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Reads the app's ingest stamp. While it is missing the first worker to notice records when the outage began;
   * once it is back, one worker turns that into the outage window used to shift deadlines.
   */
  async readIngest(nowMs: number = Date.now()): Promise<IngestStatus> {
    const redis = this.redisService.getClient();
    // ioredis queues commands while disconnected: never wait on it.
    if (redis.status !== 'ready') return { up: false };
    try {
      return await Promise.race([
        (async (): Promise<IngestStatus> => {
          if (!(await redis.get(HEARTBEAT_INGEST_KEY))) {
            const started = await redis.set(
              INGEST_DOWN_SINCE_KEY,
              String(nowMs - INGEST_STAMP_TTL_MS),
              'NX',
            );
            if (started)
              this.logger.warn(
                `Heartbeat ingest stamp ${HEARTBEAT_INGEST_KEY} is missing (app down or not writing it): heartbeat miss detection is paused`,
              );
            return { up: false };
          }
          // One script: no reader can see the down-since marker gone before the outage window exists.
          const [closed, raw] = (await redis.eval(
            CLOSE_OUTAGE_SCRIPT,
            2,
            INGEST_DOWN_SINCE_KEY,
            INGEST_OUTAGE_KEY,
            String(nowMs),
          )) as [number, string];
          const outage = raw ? parseOutage(raw) : undefined;
          if (closed === 1 && outage)
            this.logger.warn(
              `Heartbeat ingest was down for ${Math.round((outage.endMs - outage.startMs) / 1000)} s; late deadlines are moved`,
            );
          return { up: true, outage };
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Redis timed out')),
            REDIS_TIMEOUT_MS,
          ).unref(),
        ),
      ]);
    } catch (error) {
      this.logger.warn(
        `Heartbeat ingest stamp unreadable, skipping miss detection: ${getErrorMessage(error)}`,
      );
      return { up: false };
    }
  }

  /** One statement: lease (3 min) up to 100 heartbeat monitors that have a new ping or may be late or overdue. */
  async claim(
    detectMisses: boolean,
  ): Promise<{ rows: HeartbeatMonitor[]; now: number }> {
    const hs = sql`c.heartbeat_state`;
    const last = sql`greatest((${hs}->>'lastPingAt')::timestamptz, coalesce((${hs}->>'anchorAt')::timestamptz, c.created_at))`;
    const shift = sql`coalesce((${hs}->>'deadlineShiftMs')::numeric, 0) * interval '1 millisecond'`;
    const grace = sql`coalesce((c.config->'heartbeat'->>'graceMinutes')::numeric, least(1440, greatest(5, round(c.frequency_minutes * 0.2))))`;
    // Looser than decideHeartbeat (no outage shift): over-claiming costs a no-op, under-claiming a missed alert.
    const overdue = detectMisses
      ? sql`OR (${hs}->>'lastPingAt' IS NOT NULL
            AND now() > ${last} + c.frequency_minutes * interval '1 minute' + ${shift}
            AND ((c.status = 'up' AND ${hs}->>'lateEpisodeKey' IS NULL)
              OR (now() > ${last} + (c.frequency_minutes + ${grace}) * interval '1 minute' + ${shift}
                AND (${hs}->>'lastMissedAt' IS NULL
                  OR (${hs}->>'lastMissedAt')::timestamptz <= now() - c.frequency_minutes * interval '1 minute'))))`
      : sql``;
    const monitors = schema.monitors;
    const rows = await this.dbService.db
      .update(monitors)
      .set({
        heartbeatState: sql`coalesce(${monitors.heartbeatState}, '{}'::jsonb) || jsonb_build_object('leaseUntil', to_jsonb(now() + interval '3 minutes'))`,
      })
      .where(
        sql`${monitors.id} = ANY(ARRAY(
          SELECT c.id FROM monitors c
          WHERE c.type = 'heartbeat' AND c.enabled AND c.status <> 'paused' AND c.deleting_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM organization pend WHERE pend.id = c.organization_id AND pend.deletion_requested_at IS NOT NULL)
            AND (${hs}->>'leaseUntil' IS NULL OR (${hs}->>'leaseUntil')::timestamptz < now())
            AND (coalesce((${hs}->>'pingSeq')::bigint, 0) > coalesce((${hs}->>'evaluatedSeq')::bigint, 0) ${overdue})
          ORDER BY c.id
          LIMIT ${CLAIM_LIMIT}
          FOR UPDATE SKIP LOCKED))`,
      )
      .returning({
        ...getTableColumns(monitors),
        dbNowMs: sql<string>`(extract(epoch from now()) * 1000)::float8`,
      });
    return {
      rows: rows.map(({ dbNowMs: _now, ...monitor }) => monitor),
      now: rows.length ? Number(rows[0].dbNowMs) : Date.now(),
    };
  }

  private async evaluate(
    monitor: HeartbeatMonitor,
    now: number,
    ingest: IngestStatus,
  ): Promise<void> {
    try {
      const decision = decideHeartbeat(monitor, now, ingest);
      if (decision.result || decision.lateEpisodeKey) {
        const billing = await this.usageTrackerService.shouldBlockExecution(
          monitor.organizationId ?? '',
          { monitorId: monitor.id },
        );
        if (billing.blocked) {
          // Billing holds are not downtime. The lease runs out and the monitor is looked at again in 3 minutes.
          this.logger.warn(
            `Heartbeat monitor ${monitor.id} skipped: ${billing.reason}`,
          );
          return;
        }
      }
      if (decision.result || decision.lateEpisodeKey) {
        // The lease may have run out during a slow batch and another worker taken over: re-assert it first.
        const renewed = await this.renewLease(monitor);
        if (!renewed) return;
        monitor = {
          ...monitor,
          heartbeatState: {
            ...monitor.heartbeatState,
            leaseUntil: renewed.leaseUntil,
          },
        };
        // A miss or late warning is stale if a ping landed after the snapshot, or the monitor was paused or
        // resumed (new anchor) meanwhile; the next sweep judges the current state.
        if (
          !decision.result?.isUp &&
          decision.result?.kind !== 'fail' &&
          (renewed.pingSeq > (monitor.heartbeatState?.pingSeq ?? 0) ||
            renewed.status === 'paused' ||
            (renewed.anchorAt ?? null) !==
              (monitor.heartbeatState?.anchorAt ?? null))
        ) {
          await this.finish(monitor, {});
          return;
        }
      }
      const state = monitor.heartbeatState ?? {};
      // A retry after a partial evaluation must not store that failure twice.
      if (
        decision.priorFailAt &&
        !(await this.hasResultAt(monitor.id, decision.priorFailAt))
      ) {
        await this.monitorService.recordExternalResult(monitor, {
          monitorId: monitor.id,
          location: 'local',
          status: 'down',
          checkedAt: decision.priorFailAt,
          isUp: false,
          details: { heartbeat: { kind: 'fail' }, errorMessage: FAIL_REASON },
        });
      }
      if (decision.result) {
        const { kind, isUp, checkedAt, responseTimeMs, reason } =
          decision.result;
        const result: MonitorExecutionResult = {
          monitorId: monitor.id,
          location: 'local',
          status: isUp ? 'up' : 'down',
          checkedAt,
          responseTimeMs,
          isUp,
          details: {
            heartbeat: {
              kind,
              ...(kind === 'ping' && responseTimeMs !== undefined
                ? { startedAt: state.lastStartAt }
                : {}),
              ...(kind !== 'missed' && state.lastUserAgent
                ? { userAgent: state.lastUserAgent }
                : {}),
            },
            ...(isUp ? {} : { errorMessage: reason }),
          },
        };
        await this.monitorService.recordExternalResult(monitor, result);
      }
      if (decision.lateEpisodeKey) {
        await this.monitorAlertService.sendWarning(
          monitor,
          'heartbeat_late',
          `No ping from "${monitor.name}" yet: it was due ${formatMinutes(monitor.frequencyMinutes)} after the last one. The monitor goes down if none arrives within the ${formatMinutes(heartbeatGraceMinutes(monitor))} grace period.`,
          decision.lateEpisodeKey,
        );
      }
      await this.finish(monitor, decision.finish);
    } catch (error) {
      // Not finished: the lease runs out and the monitor is evaluated again.
      this.logger.error(
        `Heartbeat evaluation failed for monitor ${monitor.id}: ${getErrorMessage(error)}`,
      );
    }
  }

  private async hasResultAt(monitorId: string, checkedAt: Date) {
    const [row] = await this.dbService.db
      .select({ id: schema.monitorResults.id })
      .from(schema.monitorResults)
      .where(
        and(
          eq(schema.monitorResults.monitorId, monitorId),
          eq(schema.monitorResults.checkedAt, checkedAt),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /** Extends this sweep's lease by 3 minutes if it still holds it; null when another worker owns the row now. */
  private async renewLease(monitor: HeartbeatMonitor): Promise<{
    leaseUntil: string;
    pingSeq: number;
    anchorAt: string | null;
    status: string;
  } | null> {
    const monitors = schema.monitors;
    const [row] = await this.dbService.db
      .update(monitors)
      .set({
        heartbeatState: sql`coalesce(${monitors.heartbeatState}, '{}'::jsonb) || jsonb_build_object('leaseUntil', to_jsonb(now() + interval '3 minutes'))`,
      })
      .where(
        sql`${monitors.id} = ${monitor.id} AND ${monitors.heartbeatState}->>'leaseUntil' = ${monitor.heartbeatState?.leaseUntil ?? null}::text`,
      )
      .returning({
        leaseUntil: sql<string>`${monitors.heartbeatState}->>'leaseUntil'`,
        pingSeq: sql<string>`coalesce(${monitors.heartbeatState}->>'pingSeq', '0')`,
        anchorAt: sql<string | null>`${monitors.heartbeatState}->>'anchorAt'`,
        status: monitors.status,
      });
    if (!row) {
      this.logger.warn(
        `Heartbeat monitor ${monitor.id} lease lost during evaluation; another worker owns it`,
      );
      return null;
    }
    return {
      leaseUntil: row.leaseUntil,
      pingSeq: Number(row.pingSeq),
      anchorAt: row.anchorAt,
      status: row.status,
    };
  }

  /** Writes the sweep's keys on top of the row's current state and releases this sweep's lease. */
  private async finish(
    monitor: HeartbeatMonitor,
    finish: HeartbeatFinish,
  ): Promise<void> {
    const monitors = schema.monitors;
    const current = sql`coalesce(${monitors.heartbeatState}, '{}'::jsonb)`;
    const lease = monitor.heartbeatState?.leaseUntil ?? null;
    // Only our own lease is released: an expired one may already belong to another worker.
    let base = sql`(CASE WHEN ${current}->>'leaseUntil' = ${lease}::text THEN ${current} - 'leaseUntil' ELSE ${current} END)`;
    if (finish.newPing)
      base = sql`(${base} - 'lateEpisodeKey' - 'deadlineShiftMs')`;
    await this.dbService.db
      .update(monitors)
      .set({
        heartbeatState: sql`${base} || jsonb_strip_nulls(jsonb_build_object(
          'evaluatedSeq', CASE WHEN ${finish.evaluatedSeq ?? null}::bigint IS NULL THEN NULL
            ELSE greatest(coalesce((${current}->>'evaluatedSeq')::bigint, 0), ${finish.evaluatedSeq ?? null}::bigint) END,
          'evaluatedFailSeq', CASE WHEN ${finish.evaluatedFailSeq ?? null}::bigint IS NULL THEN NULL
            ELSE greatest(coalesce((${current}->>'evaluatedFailSeq')::bigint, 0), ${finish.evaluatedFailSeq ?? null}::bigint) END,
          'lastMissedAt', ${finish.lastMissedAt ?? null}::text,
          'lateEpisodeKey', ${finish.lateEpisodeKey ?? null}::text,
          'deadlineShiftedFor', ${finish.deadlineShiftedFor ?? null}::text,
          'deadlineShiftMs', ${finish.deadlineShiftMs ?? null}::bigint
        ))`,
      })
      .where(eq(monitors.id, monitor.id));
  }
}

function parseOutage(raw: string): IngestOutage | undefined {
  try {
    const value = JSON.parse(raw) as Partial<IngestOutage>;
    return typeof value.id === 'string' &&
      typeof value.startMs === 'number' &&
      typeof value.endMs === 'number'
      ? (value as IngestOutage)
      : undefined;
  } catch {
    return undefined;
  }
}
