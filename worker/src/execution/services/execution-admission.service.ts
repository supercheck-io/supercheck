import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema';
import { DB_PROVIDER_TOKEN } from '../../db/db.constants';
import { isSelfHostedEnvironment } from '../../common/runtime-mode';
import { getBillableMs } from '../../common/billable-ms';
import { ContainerExecutorService } from '../../common/security/container-executor.service';

export function hasActiveExecutionPlan(
  org:
    | {
        polarCustomerId?: string | null;
        subscriptionPlan?: string | null;
        subscriptionStatus?: string | null;
        subscriptionEndsAt?: Date | null;
      }
    | null
    | undefined,
): boolean {
  return (
    !!org?.polarCustomerId &&
    (org.subscriptionPlan === 'plus' || org.subscriptionPlan === 'pro') &&
    (org.subscriptionStatus === 'active' ||
      org.subscriptionStatus === 'past_due' ||
      (org.subscriptionStatus === 'canceled' &&
        !!org.subscriptionEndsAt &&
        org.subscriptionEndsAt.getTime() > Date.now()))
  );
}

/** Retryable: the organization's execution slot is occupied. */
export class ExecutionCapacityError extends Error {}
/** Not retryable: the organization has no usable entitlement or allowance. */
export class ExecutionEntitlementError extends Error {}
/**
 * Pod scheduling, image start, shutdown and report export happen outside the
 * reserved run time. A limited run's pod deadline adds this headroom; the
 * allowance is still charged for the reserved time only.
 */
export const LIMITED_RUN_OVERHEAD_MS = 90_000;
/** Smallest run the executor accepts (see container resource validation). */
export const MIN_RESERVED_RUN_MS = 5_000;
/**
 * A reservation holds capacity for this long without a renewal. The owner renews
 * it while the run is alive, so a crashed worker's slot frees itself within one
 * TTL instead of after the run's full timeout.
 */
export const RESERVATION_LEASE_TTL_MS = 5 * 60 * 1000;
export const RESERVATION_RENEW_INTERVAL_MS = 60 * 1000;
/** Finished reservations are kept this long for diagnosis, then pruned. */
export const RESERVATION_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const PRUNE_BATCH = 50;
export interface ExecutionReservation {
  runId: string;
  organizationId: string;
  ownerToken: string;
  reservedMs: number;
  limited: boolean;
  k6MaxVus?: number;
  /** Set for limited load tests once the workload is parsed; charged to the load-test allowance. */
  vus?: number;
  /** When this process took the reservation (for shutdown accounting). */
  startedAtMs?: number;
  expiresAt?: Date;
}

@Injectable()
export class ExecutionAdmissionService implements OnApplicationShutdown {
  private readonly logger = new Logger(ExecutionAdmissionService.name);
  /** Reservations this process holds, so a graceful shutdown can settle them. */
  private readonly held = new Map<string, ExecutionReservation>();

  constructor(
    @Inject(DB_PROVIDER_TOKEN)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Optional() private readonly executor?: ContainerExecutorService,
  ) {}

  async reserve(
    organizationId: string | undefined,
    runId: string,
    kind: 'playwright' | 'k6',
    requestedMs: number,
  ): Promise<ExecutionReservation | undefined> {
    if (isSelfHostedEnvironment()) return undefined;
    if (
      !organizationId ||
      !Number.isSafeInteger(requestedMs) ||
      requestedMs < 1000
    )
      throw new ExecutionEntitlementError('Execution entitlement is required');
    return this.db.transaction(async (tx) => {
      const [org] = await tx
        .select({
          id: schema.organization.id,
          customer: schema.organization.polarCustomerId,
          plan: schema.organization.subscriptionPlan,
          status: schema.organization.subscriptionStatus,
          endsAt: schema.organization.subscriptionEndsAt,
        })
        .from(schema.organization)
        .where(eq(schema.organization.id, organizationId))
        .for('update');
      if (!org)
        throw new ExecutionEntitlementError(
          'Execution entitlement is required',
        );
      // Settle first so a crashed run's charge is part of the allowance computed below.
      await this.settleAbandoned(tx, organizationId);
      const standard = hasActiveExecutionPlan({
        polarCustomerId: org.customer,
        subscriptionPlan: org.plan,
        subscriptionStatus: org.status,
        subscriptionEndsAt: org.endsAt,
      });
      const entitlement = standard
        ? undefined
        : await tx.query.executionEntitlements.findFirst({
            where: eq(
              schema.executionEntitlements.organizationId,
              organizationId,
            ),
          });
      if (
        !standard &&
        (!entitlement || entitlement.expiresAt.getTime() <= Date.now())
      )
        throw new ExecutionEntitlementError(
          'Execution entitlement has expired or is unavailable',
        );
      const limits = standard
        ? await tx.query.planLimits.findFirst({
            where: eq(schema.planLimits.plan, org.plan!),
            columns: { runningCapacity: true },
          })
        : entitlement;
      if (
        !limits ||
        !Number.isSafeInteger(limits.runningCapacity) ||
        limits.runningCapacity < 1
      )
        throw new ExecutionEntitlementError(
          'Execution plan limits are unavailable',
        );
      const [active] = await tx
        .select({
          count: sql<number>`count(*)::integer`,
          reserved: sql<number>`coalesce(sum(case when ${schema.executionReservations.kind} = 'playwright' then ${schema.executionReservations.reservedMs} else 0 end),0)::bigint`,
        })
        .from(schema.executionReservations)
        .where(
          and(
            eq(schema.executionReservations.organizationId, organizationId),
            isNull(schema.executionReservations.finishedAt),
            sql`${schema.executionReservations.leaseExpiresAt} > now()`,
          ),
        );
      if (active.count >= limits.runningCapacity)
        throw new ExecutionCapacityError(
          'Organization execution capacity is occupied',
        );
      let reservedMs = 0;
      if (entitlement) {
        const remaining =
          kind === 'playwright'
            ? entitlement.playwrightBudgetMs -
              entitlement.playwrightUsedMs -
              Number(active.reserved)
            : requestedMs;
        reservedMs =
          Math.floor(
            Math.min(
              requestedMs,
              remaining,
              entitlement.expiresAt.getTime() - Date.now(),
            ) / 1000,
          ) * 1000;
        if (
          !Number.isSafeInteger(reservedMs) ||
          reservedMs < MIN_RESERVED_RUN_MS
        )
          throw new ExecutionEntitlementError(
            'Execution allowance is exhausted',
          );
      }
      const existing = await tx.query.executionReservations.findFirst({
        where: eq(schema.executionReservations.runId, runId),
      });
      if (
        existing &&
        (existing.organizationId !== organizationId ||
          (!existing.finishedAt &&
            existing.leaseExpiresAt.getTime() > Date.now()))
      )
        throw new ExecutionCapacityError(
          'Execution already owns a reservation',
        );
      const ownerToken = randomUUID();
      const startedAt = new Date();
      const values = {
        runId,
        organizationId,
        kind,
        tier: standard ? ('paid' as const) : ('trial' as const),
        ownerToken,
        reservedMs,
        usedMs: 0,
        startedAt,
        vus: 0,
        finishedAt: null,
        leaseExpiresAt: new Date(
          startedAt.getTime() + RESERVATION_LEASE_TTL_MS,
        ),
      };
      if (existing)
        await tx
          .update(schema.executionReservations)
          .set(values)
          .where(eq(schema.executionReservations.runId, runId));
      else await tx.insert(schema.executionReservations).values(values);
      await this.pruneFinished(tx, organizationId);
      return {
        runId,
        organizationId,
        ownerToken,
        reservedMs,
        startedAtMs: startedAt.getTime(),
        limited: !!entitlement,
        k6MaxVus: entitlement?.k6MaxVus,
        expiresAt: entitlement?.expiresAt,
      };
    });
  }

  /** Extends the lease while the run is alive. Returns false if this owner no longer holds it. */
  async renew(reservation: ExecutionReservation): Promise<boolean> {
    const renewed = await this.db
      .update(schema.executionReservations)
      .set({ leaseExpiresAt: new Date(Date.now() + RESERVATION_LEASE_TTL_MS) })
      .where(
        and(
          eq(schema.executionReservations.runId, reservation.runId),
          eq(schema.executionReservations.ownerToken, reservation.ownerToken),
          isNull(schema.executionReservations.finishedAt),
        ),
      )
      .returning({ runId: schema.executionReservations.runId });
    return renewed.length > 0;
  }

  /**
   * Closes reservations of this organization whose owner stopped renewing (a crash or a deploy
   * that killed the worker). They already stopped counting toward capacity; this also charges the
   * time the lease was alive so a crashed trial run is not free. Runs under the organization lock.
   */
  private async settleAbandoned(
    tx: Pick<PostgresJsDatabase<typeof schema>, 'select' | 'update'>,
    organizationId: string,
  ): Promise<void> {
    const lapsed = await tx
      .select()
      .from(schema.executionReservations)
      .where(
        and(
          eq(schema.executionReservations.organizationId, organizationId),
          isNull(schema.executionReservations.finishedAt),
          sql`${schema.executionReservations.leaseExpiresAt} <= now()`,
        ),
      )
      .limit(PRUNE_BATCH);
    for (const row of lapsed) {
      // The lease was last extended to renewal + TTL, so the run was alive until one TTL before it.
      const aliveMs = Math.max(
        0,
        row.leaseExpiresAt.getTime() -
          RESERVATION_LEASE_TTL_MS -
          row.startedAt.getTime(),
      );
      const chargedMs =
        row.tier === 'trial' ? Math.min(aliveMs, row.reservedMs) : 0;
      // Re-check the lease in the UPDATE itself: an owner whose renewal just landed is alive and
      // must neither be closed nor charged.
      const closed = await tx
        .update(schema.executionReservations)
        .set({ usedMs: chargedMs, finishedAt: row.leaseExpiresAt })
        .where(
          and(
            eq(schema.executionReservations.runId, row.runId),
            isNull(schema.executionReservations.finishedAt),
            eq(schema.executionReservations.leaseExpiresAt, row.leaseExpiresAt),
            sql`${schema.executionReservations.leaseExpiresAt} <= now()`,
          ),
        )
        .returning({ runId: schema.executionReservations.runId });
      if (closed.length)
        await this.charge(
          tx,
          organizationId,
          row.tier === 'trial',
          row.kind,
          chargedMs,
          row.vus,
        );
    }
  }

  /** Adds a finished limited run to the organization's allowance. */
  private async charge(
    tx: Pick<PostgresJsDatabase<typeof schema>, 'update'>,
    organizationId: string,
    limited: boolean,
    kind: string,
    chargedMs: number,
    vus: number,
  ): Promise<void> {
    if (!limited || chargedMs <= 0) return;
    if (kind === 'playwright')
      await tx
        .update(schema.executionEntitlements)
        .set({
          playwrightUsedMs: sql`${schema.executionEntitlements.playwrightUsedMs} + ${chargedMs}`,
        })
        .where(eq(schema.executionEntitlements.organizationId, organizationId));
    else if (kind === 'k6' && vus > 0)
      await tx
        .update(schema.executionEntitlements)
        .set({
          k6UsedVuMs: sql`${schema.executionEntitlements.k6UsedVuMs} + ${chargedMs * vus}`,
        })
        .where(eq(schema.executionEntitlements.organizationId, organizationId));
  }

  /**
   * Fixes the size of a limited load test once its workload is parsed and checks it against the
   * remaining load-test allowance (VUs x time, minus what other active runs have reserved).
   */
  async setK6Workload(
    reservation: ExecutionReservation,
    vus: number,
    durationMs: number,
  ): Promise<void> {
    if (!reservation.limited) return;
    await this.db.transaction(async (tx) => {
      await tx
        .select({ id: schema.organization.id })
        .from(schema.organization)
        .where(eq(schema.organization.id, reservation.organizationId))
        .for('update');
      const entitlement = await tx.query.executionEntitlements.findFirst({
        where: eq(
          schema.executionEntitlements.organizationId,
          reservation.organizationId,
        ),
      });
      const [others] = await tx
        .select({
          reserved: sql<number>`coalesce(sum(${schema.executionReservations.reservedMs} * ${schema.executionReservations.vus}),0)::bigint`,
        })
        .from(schema.executionReservations)
        .where(
          and(
            eq(
              schema.executionReservations.organizationId,
              reservation.organizationId,
            ),
            eq(schema.executionReservations.kind, 'k6'),
            isNull(schema.executionReservations.finishedAt),
            sql`${schema.executionReservations.leaseExpiresAt} > now()`,
            sql`${schema.executionReservations.runId} <> ${reservation.runId}`,
          ),
        );
      const remaining = entitlement
        ? entitlement.k6BudgetVuMs -
          entitlement.k6UsedVuMs -
          Number(others.reserved)
        : 0;
      if (vus * durationMs > remaining)
        throw new ExecutionEntitlementError(
          'Trial load-testing allowance is exhausted',
        );
      const updated = await tx
        .update(schema.executionReservations)
        .set({ vus, reservedMs: durationMs })
        .where(
          and(
            eq(schema.executionReservations.runId, reservation.runId),
            eq(schema.executionReservations.ownerToken, reservation.ownerToken),
            isNull(schema.executionReservations.finishedAt),
            sql`${schema.executionReservations.leaseExpiresAt} > now()`,
          ),
        )
        .returning({ runId: schema.executionReservations.runId });
      // The lease lapsed (and may have been settled) while this run was starting: running now
      // would be unmetered, so ask the queue to try again with a fresh reservation.
      if (!updated.length)
        throw new ExecutionCapacityError(
          'Execution reservation was lost before the workload started',
        );
    });
    reservation.vus = vus;
    reservation.reservedMs = durationMs;
  }

  /**
   * Bounded cleanup so finished reservations do not accumulate forever. Limited to the organization whose
   * lock is held: another organization's crashed run is only charged when that organization next reserves
   * (`settleAbandoned`), so deleting it from here would discard usage that was never billed.
   */
  private async pruneFinished(
    tx: Pick<PostgresJsDatabase<typeof schema>, 'select' | 'delete'>,
    organizationId: string,
  ): Promise<void> {
    const stale = await tx
      .select({ runId: schema.executionReservations.runId })
      .from(schema.executionReservations)
      .where(
        and(
          eq(schema.executionReservations.organizationId, organizationId),
          or(
            lt(
              schema.executionReservations.finishedAt,
              new Date(Date.now() - RESERVATION_RETENTION_MS),
            ),
            // A crashed run never finished; once its lease has been lapsed this long it is only clutter.
            and(
              isNull(schema.executionReservations.finishedAt),
              lt(
                schema.executionReservations.leaseExpiresAt,
                new Date(Date.now() - RESERVATION_RETENTION_MS),
              ),
            ),
          ),
        ),
      )
      .limit(PRUNE_BATCH);
    if (stale.length)
      await tx.delete(schema.executionReservations).where(
        inArray(
          schema.executionReservations.runId,
          stale.map((row) => row.runId),
        ),
      );
  }

  async finish(
    reservation: ExecutionReservation,
    observedMs: number,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .select({ id: schema.organization.id })
        .from(schema.organization)
        .where(eq(schema.organization.id, reservation.organizationId))
        .for('update');
      const [current] = await tx
        .select()
        .from(schema.executionReservations)
        .where(
          and(
            eq(schema.executionReservations.runId, reservation.runId),
            eq(schema.executionReservations.ownerToken, reservation.ownerToken),
            isNull(schema.executionReservations.finishedAt),
          ),
        )
        .for('update');
      if (!current) return;
      const usedMs = Math.max(
        0,
        Math.ceil(Number.isFinite(observedMs) ? observedMs : 0),
      );
      const chargedMs = reservation.limited
        ? Math.min(usedMs, current.reservedMs)
        : usedMs;
      await this.charge(
        tx,
        reservation.organizationId,
        reservation.limited,
        current.kind,
        chargedMs,
        current.vus,
      );
      await tx
        .update(schema.executionReservations)
        .set({ usedMs: chargedMs, finishedAt: new Date() })
        .where(eq(schema.executionReservations.runId, reservation.runId));
    });
  }

  /**
   * Keeps the lease alive. If it cannot be kept (taken over, or no successful renewal for a whole
   * lease because the database is unreachable), another run may be admitted for this organization
   * while this container still runs. So this process stops its own container. It does not use the
   * shared cancellation key: that is per run id and would also cancel the replacement attempt.
   */
  private startRenewal(reservation: ExecutionReservation): NodeJS.Timeout {
    let lastRenewedAt = Date.now();
    let fenced = false;
    const fence = (reason: string) => {
      if (fenced) return;
      fenced = true;
      this.logger.error(
        `Execution reservation ${reservation.runId} ${reason}; stopping the run so it cannot overlap a replacement`,
      );
      if (!this.executor) {
        this.logger.error(
          `No executor is available to stop run ${reservation.runId}; it may overlap a replacement`,
        );
        return;
      }
      this.executor.abortRun(reservation.runId);
    };
    const timer = setInterval(() => {
      this.renew(reservation)
        .then((held) => {
          if (held) lastRenewedAt = Date.now();
          else fence('was taken over');
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Unable to renew execution reservation ${reservation.runId}: ${String(error)}`,
          );
          if (Date.now() - lastRenewedAt >= RESERVATION_LEASE_TTL_MS)
            fence('could not be renewed for a whole lease');
        });
    }, RESERVATION_RENEW_INTERVAL_MS);
    timer.unref();
    return timer;
  }

  async run<T extends { billableMs?: number }>(
    organizationId: string | undefined,
    runId: string,
    kind: 'playwright' | 'k6',
    timeoutMs: number,
    callback: (reservation: ExecutionReservation | undefined) => Promise<T>,
  ): Promise<T> {
    const reservation = await this.reserve(
      organizationId,
      runId,
      kind,
      timeoutMs,
    );
    let usedMs = 0;
    const renewal = reservation ? this.startRenewal(reservation) : undefined;
    if (reservation) this.held.set(reservation.runId, reservation);
    try {
      const result = await callback(reservation);
      usedMs = result.billableMs ?? 0;
      return result;
    } catch (error) {
      usedMs = getBillableMs(error);
      throw error;
    } finally {
      if (renewal) clearInterval(renewal);
      if (reservation) {
        this.held.delete(reservation.runId);
        // The result is already produced (or the original error is in flight); a
        // bookkeeping failure must not replace it. The lease reclaims the slot.
        await this.finish(reservation, usedMs).catch((error: unknown) =>
          this.logger.error(
            `Unable to release execution reservation ${reservation.runId}: ${String(error)}`,
          ),
        );
      }
    }
  }

  /**
   * A deploy stops this process while runs may still hold reservations. Release them now so the
   * organization's capacity does not stay blocked for a lease; the runs are retried by the queue.
   * Time is charged from the reservation start, capped at what was reserved.
   */
  async onApplicationShutdown(): Promise<void> {
    const reservations = [...this.held.values()];
    this.held.clear();
    await Promise.all(
      reservations.map((reservation) =>
        this.finish(
          reservation,
          Date.now() - (reservation.startedAtMs ?? Date.now()),
        ).catch((error: unknown) =>
          this.logger.error(
            `Unable to settle execution reservation ${reservation.runId} at shutdown: ${String(error)}`,
          ),
        ),
      ),
    );
  }
}
