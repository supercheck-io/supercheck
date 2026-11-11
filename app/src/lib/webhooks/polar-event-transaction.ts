import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { organization } from "@/db/schema";
import { createLogger } from "@/lib/logger/index";
import { db } from "@/utils/db";

const logger = createLogger({ module: "polar-webhooks" }) as {
  error: (data: unknown, message?: string) => void;
};

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const context = new AsyncLocalStorage<{
  tx: Transaction;
  organizationId: string;
}>();

/** The organization the current ordered event is running for, if any. */
export function getPolarWebhookOrganizationId(): string | undefined {
  return context.getStore()?.organizationId;
}

export function getPolarWebhookDb(organizationId?: string) {
  const current = context.getStore();
  if (current && organizationId && current.organizationId !== organizationId) {
    throw new Error("Polar webhook resolved conflicting organizations");
  }
  return current?.tx ?? db;
}

/**
 * The event can never be applied, so retrying only counts toward Polar disabling the endpoint after
 * ten consecutive failures. It still rolls back the surrounding transaction (no state or ordering
 * change); the plugin layer logs it and acknowledges the delivery. Reconciliation repairs real misses.
 */
export class UnrecoverableWebhookError extends Error {
  /** Event and tenant references, attached by the event dispatcher, so the acknowledged failure can be traced. */
  context?: UnrecoverableWebhookContext;
  constructor(message: string) {
    super(message);
    this.name = "UnrecoverableWebhookError";
  }
}

export type UnrecoverableWebhookContext = {
  eventType: string;
  eventId?: string;
  /** The provider resource the event is about (subscription, customer, order). */
  resourceId?: string;
  organizationId?: string;
  customerId?: string;
  subscriptionId?: string;
};

export async function runOrderedPolarEvent(
  input: {
    organizationId: string;
    timestamp: string | Date | undefined;
    eventKey: string;
    subscriptionId: string | null;
    canReplaceSubscription: boolean;
    periodStart: Date | null;
    affectsSubscriptionState?: boolean;
    /** Normalized subscription state carried by this event, for tie checks. */
    snapshot?: { status: string | undefined; plan: string | null };
    /** True when the organization was deliberately deleted meanwhile: acknowledge instead of retrying. */
    organizationDeleted?: () => Promise<boolean>;
    /**
     * A cancel/revoke for a subscription the organization does not hold. It may be stale (an old subscription)
     * or early (a new one whose activation has not arrived). While `retry` is true (a fresh event) fail
     * retryably so the activation can land first; afterwards acknowledge it and retire the subscription, so a
     * late activation can never bind it.
     */
    ignoreWhenReplaced?: { retry: boolean };
  },
  apply: () => Promise<void>,
) {
  const timestamp = input.timestamp ? new Date(input.timestamp) : null;
  if (!timestamp || !Number.isFinite(timestamp.getTime())) {
    throw new Error("Polar billing event requires a valid provider timestamp");
  }

  return db.transaction(async (tx) => {
    // Row locks work across replicas and transaction-pooled PostgreSQL. Read
    // ordering state only after acquiring the lock, never from a stale lookup.
    const [org] = await tx
      .select()
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .for("update");
    if (!org) {
      if (await input.organizationDeleted?.()) return;
      throw new UnrecoverableWebhookError("Polar billing organization not found");
    }

    if (input.affectsSubscriptionState !== false && org.polarWebhookTimestamp) {
      const difference =
        timestamp.getTime() - org.polarWebhookTimestamp.getTime();
      if (
        difference < 0 ||
        (difference === 0 && org.polarWebhookEventKey === input.eventKey)
      )
        return;
      // SDK Date objects have millisecond precision. Polar emits the catch-all
      // subscription.updated together with the specific lifecycle event from
      // one state change. Apply a tie only when it is on the bound
      // subscription and carries the state already applied; a conflicting
      // snapshot (e.g. active after revoked) could restore access, so it and
      // any other tie fail retryably for reconciliation.
      const snapshot = input.snapshot;
      const consistentTie = Boolean(
        input.subscriptionId &&
          input.subscriptionId === org.subscriptionId &&
          snapshot?.status &&
          snapshot.status === org.subscriptionStatus &&
          (snapshot.status === "none" || snapshot.plan === org.subscriptionPlan),
      );
      if (difference === 0 && !consistentTie)
        throw new Error(
          "Ambiguous Polar event order; reconcile customer state before retrying",
        );
    }

    const retired = org.polarRetiredSubscriptionIds ?? [];
    if (input.subscriptionId && retired.includes(input.subscriptionId)) return;
    const replacing = Boolean(
      input.subscriptionId &&
        org.subscriptionId &&
        input.subscriptionId !== org.subscriptionId,
    );
    if (replacing && input.ignoreWhenReplaced) {
      if (input.ignoreWhenReplaced.retry) throw new Error("Waiting for replacement subscription.active event");
      console.warn(`[Polar] Ignoring a ${input.eventKey.split(":")[0]} for a subscription organization ${org.id} does not hold; retiring it`);
      await tx.update(organization).set({ polarRetiredSubscriptionIds: [...retired, input.subscriptionId!] }).where(eq(organization.id, org.id));
      return;
    }
    if (replacing) {
      // An update/payment on an old subscription cannot replace a newer one.
      // Only subscription.active establishes a replacement binding.
      if (!input.canReplaceSubscription)
        throw new Error("Waiting for replacement subscription.active event");
      if (
        !input.periodStart ||
        (org.usagePeriodStart && input.periodStart < org.usagePeriodStart)
      ) {
        throw new Error(
          "Replacement subscription requires a current billing period",
        );
      }
      // Binding is kept, but two paid subscriptions may now exist: surface it for log alerting.
      if (org.subscriptionStatus === "active" || org.subscriptionStatus === "past_due") {
        logger.error(
          {
            // UUIDv7 prefixes are timestamp bits, so the suffix identifies the organization.
            organizationId: org.id.slice(-8),
            replacedSubscriptionId: org.subscriptionId?.slice(0, 8),
            newSubscriptionId: input.subscriptionId?.slice(0, 8),
          },
          "Active subscription replaced another active subscription; check for duplicate billing",
        );
      }
    }

    await context.run({ tx, organizationId: org.id }, apply);
    // Payment events can roll usage over but are not subscription snapshots.
    // Their timestamps must not suppress a subscription lifecycle event.
    if (input.affectsSubscriptionState === false) return;
    await tx
      .update(organization)
      .set({
        polarWebhookTimestamp: timestamp,
        polarWebhookEventKey: input.eventKey,
        ...(replacing && org.subscriptionId
          ? { polarRetiredSubscriptionIds: [...retired, org.subscriptionId] }
          : {}),
      })
      .where(eq(organization.id, org.id));
  });
}
