import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema';
import { DB_PROVIDER_TOKEN } from '../../db/db.constants';
import { isSelfHostedEnvironment } from '../../common/runtime-mode';
import { getBillableMs } from '../../common/billable-ms';

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
/** Extra time a crashed worker's reservation holds capacity beyond its run timeout. */
export const RESERVATION_LEASE_GRACE_MS = 10 * 60 * 1000;
export interface ExecutionReservation {
  runId: string;
  organizationId: string;
  ownerToken: string;
  reservedMs: number;
  limited: boolean;
  k6MaxVus?: number;
  expiresAt?: Date;
}

@Injectable()
export class ExecutionAdmissionService {
  private readonly logger = new Logger(ExecutionAdmissionService.name);

  constructor(
    @Inject(DB_PROVIDER_TOKEN)
    private readonly db: PostgresJsDatabase<typeof schema>,
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
        finishedAt: null,
        leaseExpiresAt: new Date(
          startedAt.getTime() +
            Math.max(requestedMs, reservedMs) +
            RESERVATION_LEASE_GRACE_MS,
        ),
      };
      if (existing)
        await tx
          .update(schema.executionReservations)
          .set(values)
          .where(eq(schema.executionReservations.runId, runId));
      else await tx.insert(schema.executionReservations).values(values);
      return {
        runId,
        organizationId,
        ownerToken,
        reservedMs,
        limited: !!entitlement,
        k6MaxVus: entitlement?.k6MaxVus,
        expiresAt: entitlement?.expiresAt,
      };
    });
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
      if (reservation.limited && current.kind === 'playwright')
        await tx
          .update(schema.executionEntitlements)
          .set({
            playwrightUsedMs: sql`${schema.executionEntitlements.playwrightUsedMs} + ${chargedMs}`,
          })
          .where(
            eq(
              schema.executionEntitlements.organizationId,
              reservation.organizationId,
            ),
          );
      await tx
        .update(schema.executionReservations)
        .set({ usedMs: chargedMs, finishedAt: new Date() })
        .where(eq(schema.executionReservations.runId, reservation.runId));
    });
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
    try {
      const result = await callback(reservation);
      usedMs = result.billableMs ?? 0;
      return result;
    } catch (error) {
      usedMs = getBillableMs(error);
      throw error;
    } finally {
      if (reservation) {
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
}
