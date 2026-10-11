import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { organization } from "@/db/schema";
import { db } from "@/utils/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const context = new AsyncLocalStorage<{
  tx: Transaction;
  organizationId: string;
}>();

export function getPolarWebhookDb(organizationId?: string) {
  const current = context.getStore();
  if (current && organizationId && current.organizationId !== organizationId) {
    throw new Error("Polar webhook resolved conflicting organizations");
  }
  return current?.tx ?? db;
}

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
    if (!org) throw new Error("Polar billing organization not found");

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
