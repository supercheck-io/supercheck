import { and, asc, eq, gt, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { organization } from "@/db/schema";
import { POLAR_API_VERSION } from "@/lib/billing/polar-client";
import { getPolarConfig, isPolarEnabled } from "@/lib/feature-flags";
import { restoreTrialSuspensions } from "@/lib/execution/trial-lifecycle";
import { createLogger } from "@/lib/logger/index";
import { getPlanFromProductId, getSubscriptionStatusFromPayload } from "@/lib/webhooks/polar-webhooks";
import { db } from "@/utils/db";
import { billingSettingsService } from "./billing-settings.service";
import { subscriptionService } from "./subscription-service";

const date = z.string().datetime({ offset: true });
const snapshotSchema = z.object({
  id: z.string().min(1), customer_id: z.string().min(1), product_id: z.string().min(1),
  status: z.enum(["active", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "trialing", "paused"]),
  cancel_at_period_end: z.boolean(), created_at: date, modified_at: date.nullable(),
  current_period_start: date, current_period_end: date,
  pending_update: z.object({ product_id: z.string().nullable(), applies_at: date.nullable() }).nullish(),
});
const logger = createLogger({ module: "subscription-reconciliation" }) as {
  error: (data: unknown, message: string) => void;
};
let cursor: string | undefined;

/** Read-only provider requests; no checkout, payment, product or subscription mutations. */
export async function reconcilePolarSubscription(organizationId: string): Promise<boolean> {
  if (!isPolarEnabled()) return false;
  const before = await db.query.organization.findFirst({ where: eq(organization.id, organizationId) });
  const config = getPolarConfig();
  if (!before?.polarCustomerId || !config) return false;
  const customerId = before.polarCustomerId;
  const base = config.server === "sandbox" ? "https://sandbox-api.polar.sh" : "https://api.polar.sh";
  const get = async (path: string): Promise<unknown> => {
    const response = await fetch(base + path, { headers: { Authorization: `Bearer ${config.accessToken}`, "Polar-Version": POLAR_API_VERSION }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Polar reconciliation lookup failed (${response.status})`);
    return response.json();
  };
  const currentSubscriptionId = async () => {
    const state = z.object({ id: z.string(), active_subscriptions: z.array(z.object({ id: z.string(), product_id: z.string() })) })
      .parse(await get(`/v1/customers/${encodeURIComponent(customerId)}/state`));
    if (state.id !== customerId) throw new Error("Polar customer state binding mismatch");
    const candidates = state.active_subscriptions.filter((sub) => getPlanFromProductId(sub.product_id));
    if (candidates.length > 1) throw new Error("Multiple Polar subscriptions require manual reconciliation");
    return candidates[0]?.id ?? null;
  };
  let subscriptionId = before.subscriptionId ?? await currentSubscriptionId();
  if (!subscriptionId) return false;
  const readSubscription = async (id: string) => {
    const value = snapshotSchema.parse(await get(`/v1/subscriptions/${encodeURIComponent(id)}`));
    if (value.id !== id || value.customer_id !== before.polarCustomerId) throw new Error("Polar subscription binding mismatch");
    return value;
  };
  let snapshot = await readSubscription(subscriptionId);
  if (["canceled", "unpaid", "incomplete_expired"].includes(snapshot.status)) {
    // A missed activation may have replaced a previously bound, now-ended subscription.
    const replacement = await currentSubscriptionId();
    if (replacement && replacement !== subscriptionId) {
      subscriptionId = replacement;
      snapshot = await readSubscription(subscriptionId);
    }
  }
  if (snapshot.pending_update?.product_id === snapshot.product_id && snapshot.pending_update.applies_at &&
    new Date(snapshot.pending_update.applies_at).getTime() > Date.now()) return false;
  const plan = getPlanFromProductId(snapshot.product_id);
  if (!plan) throw new Error("Unknown Polar subscription product");
  const status = getSubscriptionStatusFromPayload({ data: snapshot });
  if (!status) throw new Error("Unknown Polar subscription status");
  const periodStart = new Date(snapshot.current_period_start);
  const periodEnd = new Date(snapshot.current_period_end);
  if (periodEnd <= periodStart) throw new Error("Invalid Polar subscription period");
  const modifiedAt = new Date(snapshot.modified_at ?? snapshot.created_at);

  return db.transaction(async (tx) => {
    const [org] = await tx.select().from(organization).where(eq(organization.id, organizationId)).for("update");
    // Never let a slow provider read overwrite a webhook or a changed tenant binding.
    if (!org || org.polarCustomerId !== before.polarCustomerId || org.subscriptionId !== before.subscriptionId ||
      org.polarWebhookEventKey !== before.polarWebhookEventKey ||
      org.polarWebhookTimestamp?.getTime() !== before.polarWebhookTimestamp?.getTime()) {
      throw new Error("Polar subscription changed during reconciliation; retry");
    }
    if (org.polarRetiredSubscriptionIds.includes(snapshot.id)) throw new Error("Retired Polar subscription cannot be restored");
    if (org.usagePeriodStart && periodStart < org.usagePeriodStart) return false;
    if (org.polarWebhookTimestamp && modifiedAt < org.polarWebhookTimestamp) {
      if (org.subscriptionId === snapshot.id && org.subscriptionStatus === status &&
        org.subscriptionPlan === (status === "none" ? null : plan) &&
        org.subscriptionStartedAt?.getTime() === periodStart.getTime() &&
        org.subscriptionEndsAt?.getTime() === periodEnd.getTime() &&
        org.usagePeriodStart?.getTime() === periodStart.getTime() &&
        org.usagePeriodEnd?.getTime() === periodEnd.getTime()) return false;
      throw new Error("Polar reconciliation snapshot may be stale; retry");
    }
    const replacing = org.subscriptionId && org.subscriptionId !== snapshot.id;
    if (replacing && status === "none") throw new Error("A replacement subscription must grant paid access");
    await subscriptionService.updateSubscription(organizationId, {
      subscriptionId: snapshot.id, subscriptionPlan: status === "none" ? null : plan, subscriptionStatus: status,
      subscriptionStartedAt: periodStart, subscriptionEndsAt: periodEnd,
    }, tx);
    // The existing monotonic period predicate prevents duplicate or old snapshots erasing usage.
    if (await subscriptionService.resetUsageCountersWithDates(organizationId, periodStart, periodEnd, tx)) {
      await billingSettingsService.resetNotificationsForPeriod(organizationId, tx);
    }
    if (status !== "none" && (!org.subscriptionPlan || org.subscriptionStatus === "none")) {
      await restoreTrialSuspensions(organizationId, tx);
    }
    await tx.update(organization).set({
      polarWebhookTimestamp: new Date(Math.max(modifiedAt.getTime(), org.polarWebhookTimestamp?.getTime() ?? 0)),
      polarWebhookEventKey: `reconciled:${snapshot.id}:${modifiedAt.toISOString()}:${status}`,
      ...(replacing ? { polarRetiredSubscriptionIds: [...org.polarRetiredSubscriptionIds, org.subscriptionId!] } : {}),
    }).where(eq(organization.id, organizationId));
    return true;
  });
}

/** Rotate over bound customers, with a per-pass time/row bound and no network calls under a DB lock. */
export async function reconcilePolarSubscriptions(assertOwned: () => void): Promise<void> {
  if (!isPolarEnabled()) return;
  const organizations = await db.query.organization.findMany({
    where: and(isNotNull(organization.polarCustomerId), ...(cursor ? [gt(organization.id, cursor)] : [])),
    orderBy: [asc(organization.id)], limit: 25,
  });
  if (!organizations.length) { cursor = undefined; return; }
  const deadline = Date.now() + 15_000;
  for (const org of organizations) {
    if (Date.now() >= deadline) break;
    assertOwned();
    cursor = org.id;
    try { await reconcilePolarSubscription(org.id); }
    catch (error) { logger.error({ error, organizationId: org.id }, "Polar subscription reconciliation failed"); }
  }
}
