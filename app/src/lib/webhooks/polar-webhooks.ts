/**
 * Polar Webhook Handlers
 * Process incoming webhook events from Polar for subscription management
 *
 * Security & Reliability:
 * - Idempotency: Atomic database operations using INSERT ON CONFLICT
 * - Multi-instance safe: Uses database-level unique constraints
 * - Logging: Uses truncated IDs to avoid leaking sensitive data
 * - Error handling: Graceful degradation on non-critical failures
 */

import { subscriptionService } from "@/lib/services/subscription-service";
import { billingSettingsService } from "@/lib/services/billing-settings.service";
import { getPolarWebhookDb, runOrderedPolarEvent } from "./polar-event-transaction";
import { organization, webhookIdempotency } from "@/db/schema";
import { eq, and, lt, lte, isNull, or } from "drizzle-orm";
import type { SubscriptionPlan } from "@/db/schema";

// A short processing lease prevents concurrent delivery from running twice.
// Completed records are retained for 24 hours to suppress provider retries.
const WEBHOOK_PROCESSING_LEASE_MS = 5 * 60 * 1000;
const WEBHOOK_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Atomically try to claim a webhook for processing (idempotency)
 * Uses INSERT ON CONFLICT to ensure only one instance processes each webhook
 *
 * @returns true if this instance should process the webhook, false if already processed/claimed
 */
async function tryClaimWebhook(
  webhookId: string,
  eventType: string
): Promise<boolean> {
  try {
    const now = new Date();
    const processingLeaseEndsAt = new Date(
      now.getTime() + WEBHOOK_PROCESSING_LEASE_MS
    );

    // First, try to insert with null status (not yet processed)
    // This is the key to preventing race conditions in multi-instance deployments
    const result = await getPolarWebhookDb()
      .insert(webhookIdempotency)
      .values({
        webhookId,
        eventType,
        resultStatus: null,
        expiresAt: processingLeaseEndsAt,
      })
      .onConflictDoNothing({
        target: [webhookIdempotency.webhookId, webhookIdempotency.eventType],
      })
      .returning();

    // If row was inserted, we own this webhook
    if (result.length > 0) {
      return true;
    }

    // Row exists. Completed/skipped events stay suppressed. Failed events may
    // retry immediately; an in-flight event may retry only after its lease.
    const existing = await getPolarWebhookDb().query.webhookIdempotency.findFirst({
      where: and(
        eq(webhookIdempotency.webhookId, webhookId),
        eq(webhookIdempotency.eventType, eventType)
      ),
    });

    if (
      existing?.resultStatus === "success" ||
      existing?.resultStatus === "skipped"
    ) {
      console.log(
        `[Polar] Webhook ${truncateId(webhookId)} already processed successfully, skipping`
      );
      return false;
    }

    if (existing) {
      const reclaimed = await getPolarWebhookDb()
        .update(webhookIdempotency)
        .set({ 
          expiresAt: processingLeaseEndsAt,
          resultStatus: null,
          resultMessage: null,
        })
        .where(
          and(
            eq(webhookIdempotency.webhookId, webhookId),
            eq(webhookIdempotency.eventType, eventType),
            or(
              eq(webhookIdempotency.resultStatus, "error"),
              and(
                isNull(webhookIdempotency.resultStatus),
                lte(webhookIdempotency.expiresAt, now)
              )
            )
          )
        )
        .returning({ id: webhookIdempotency.id });

      if (reclaimed.length > 0) {
        console.log(
          `[Polar] Webhook ${truncateId(webhookId)} reclaimed after error or expired processing lease`
        );
        return true;
      }
    }

    // Do not acknowledge an overlapping delivery while the original handler is
    // unresolved. If the original later fails, Polar must keep retrying until
    // the lease expires and a replica can reclaim the event.
    throw new Error(
      `Polar webhook ${truncateId(webhookId)} is already being processed`
    );
  } catch (error) {
    // Billing state changes must never run without idempotency. Throw so Polar
    // retries after the database/migration issue is fixed.
    console.error(`[Polar] Idempotency claim failed: ${error}`);
    throw error;
  }
}

/**
 * Update webhook processing result
 * Called after processing to record the outcome
 */
async function updateWebhookResult(
  webhookId: string,
  eventType: string,
  status: "success" | "error" | "skipped",
  message?: string
): Promise<void> {
  try {
    await getPolarWebhookDb()
      .update(webhookIdempotency)
      .set({
        resultStatus: status,
        resultMessage: message,
        expiresAt: new Date(Date.now() + WEBHOOK_IDEMPOTENCY_TTL_MS),
      })
      .where(
        and(
          eq(webhookIdempotency.webhookId, webhookId),
          eq(webhookIdempotency.eventType, eventType)
        )
      );
  } catch (error) {
    console.warn(`[Polar] Failed to update webhook result: ${error}`);
    throw error;
  }

  // Never acknowledge a billing-state event that this application did not
  // apply. Throwing makes the signature-verified webhook endpoint return a
  // retryable failure; the next delivery can reclaim the recorded error.
  if (status === "error") {
    throw new Error(message ?? `Failed to process Polar ${eventType} webhook`);
  }
}

/**
 * Clean up expired webhook idempotency records
 * Should be called periodically (e.g., via cron job)
 */
export async function cleanupExpiredWebhooks(): Promise<number> {
  try {
    const now = new Date();
    const result = await getPolarWebhookDb()
      .delete(webhookIdempotency)
      .where(lt(webhookIdempotency.expiresAt, now))
      .returning();

    return result.length;
  } catch (error) {
    console.error(`[Polar] Failed to cleanup expired webhooks: ${error}`);
    return 0;
  }
}

/**
 * Truncate ID for safe logging (doesn't expose full IDs)
 */
function truncateId(id: string | undefined | null): string {
  if (!id) return "unknown";
  return id.length > 8 ? `${id.substring(0, 8)}...` : id;
}

// Polar webhook payload types
// Note: Polar sends camelCase field names
interface PolarWebhookPayload {
  id?: string;
  type?: string;
  timestamp?: string | Date;
  data: {
    id: string;
    // Polar uses camelCase
    customerId?: string;
    productId?: string;
    status?: string;
    // Subscription billing period dates from Polar
    startsAt?: string | Date; // ISO date when subscription period starts
    endsAt?: string | Date; // ISO date when subscription period ends
    currentPeriodStart?: string | Date; // Alternative field name
    currentPeriodEnd?: string | Date; // Alternative field name
    amount?: number;
    currency?: string;
    metadata?: {
      referenceId?: string;
      [key: string]: unknown;
    };
    checkout?: {
      metadata?: {
        referenceId?: string;
        [key: string]: unknown;
      };
    };
    // Also include product object for nested product ID
    product?: {
      id?: string;
      [key: string]: unknown;
    };
    pendingUpdate?: {
      productId?: string | null;
      appliesAt?: string | Date;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Build a stable webhook event key for idempotency.
 * Prefer top-level webhook event id when available.
 * Fallback to a deterministic fingerprint of payload fields.
 */
function getWebhookEventKey(payload: PolarWebhookPayload, eventType: string): string {
  if (typeof payload.id === "string" && payload.id.length > 0) {
    return payload.id;
  }

  const data = payload.data as Record<string, unknown>;
  const fingerprintParts = [
    eventType,
    String(payload.type || ""),
    String(payload.timestamp || ""),
    String(data.id || ""),
    String(data.status || ""),
    String(data.modifiedAt || ""),
    String(data.modified_at || ""),
    String(data.currentPeriodStart || ""),
    String(data.currentPeriodEnd || ""),
    String(data.current_period_start || ""),
    String(data.current_period_end || ""),
    String(data.startsAt || ""),
    String(data.endsAt || ""),
    String(data.started_at || ""),
    String(data.ends_at || ""),
  ];

  return fingerprintParts.join("|");
}

/**
 * Extract subscription ID from payload
 */
function getSubscriptionIdFromPayload(payload: PolarWebhookPayload): string {
  // For subscription events, data.id is the subscription id
  if (payload.data.id) {
    return payload.data.id;
  }

  const snakeData = payload.data as Record<string, unknown>;
  if (typeof snakeData.subscription_id === "string") {
    return snakeData.subscription_id;
  }

  const subscription = snakeData.subscription as { id?: string } | undefined;
  if (subscription?.id) {
    return subscription.id;
  }

  return "";
}

/**
 * Helper to get subscription period dates from payload
 * Returns the billing cycle start and end dates from Polar
 */
export function getSubscriptionDatesFromPayload(payload: PolarWebhookPayload): {
  startsAt: Date | null;
  endsAt: Date | null;
} {
  const data = payload.data as Record<string, unknown>;
  const subscription = data.subscription as Record<string, unknown> | undefined;

  const readDate = (...values: unknown[]): Date | null => {
    for (const value of values) {
      if (value instanceof Date) {
        if (!Number.isNaN(value.getTime())) {
          return new Date(value.getTime());
        }
        continue;
      }

      if (typeof value !== "string" || value.length === 0) continue;

      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date;
    }
    return null;
  };

  const startsAt = readDate(
    payload.data.currentPeriodStart,
    data.current_period_start,
    payload.data.startsAt,
    data.starts_at,
    data.started_at,
    subscription?.currentPeriodStart,
    subscription?.current_period_start,
    subscription?.startsAt,
    subscription?.starts_at,
    subscription?.started_at
  );

  const endsAt = readDate(
    payload.data.currentPeriodEnd,
    data.current_period_end,
    payload.data.endsAt,
    data.ends_at,
    data.ended_at,
    subscription?.currentPeriodEnd,
    subscription?.current_period_end,
    subscription?.endsAt,
    subscription?.ends_at,
    subscription?.ended_at
  );

  return { startsAt, endsAt };
}

function isSameInstant(a: Date | null | undefined, b: Date | null | undefined) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

function isSameBillingPeriod(
  org: typeof organization.$inferSelect,
  dates: { startsAt: Date | null; endsAt: Date | null }
) {
  return (
    isSameInstant(org.usagePeriodStart, dates.startsAt) &&
    isSameInstant(org.usagePeriodEnd, dates.endsAt)
  );
}

async function resetUsageForNewBillingPeriod(
  org: typeof organization.$inferSelect,
  dates: { startsAt: Date | null; endsAt: Date | null },
  eventType: string
): Promise<boolean> {
  // Renewal period resets must be tied to explicit Polar billing period dates.
  // Missing dates fall back elsewhere for first activation, but should not
  // reset usage during ambiguous update/order events.
  if (!dates.startsAt || !dates.endsAt || isSameBillingPeriod(org, dates)) {
    return false;
  }

  const reset = await subscriptionService.resetUsageCountersWithDates(
    org.id,
    dates.startsAt,
    dates.endsAt,
    getPolarWebhookDb(org.id)
  );
  if (!reset) return false;

  await billingSettingsService.resetNotificationsForPeriod(org.id, getPolarWebhookDb(org.id));

  console.log(
    `[Polar] ✅ Reset usage for new billing period via ${eventType} for org ${truncateId(org.id)} (${dates.startsAt.toISOString()} - ${dates.endsAt.toISOString()})`
  );
  return true;
}

/**
 * Helper to get product ID from payload (handles different webhook formats)
 */
function getProductIdFromPayload(payload: PolarWebhookPayload): string {
  // Direct productId (camelCase)
  if (payload.data.productId) {
    return payload.data.productId;
  }
  // Snake_case (Polar sends this format)
  const snakeData = payload.data as Record<string, unknown>;
  if (snakeData.product_id && typeof snakeData.product_id === 'string') {
    return snakeData.product_id;
  }
  // Nested in product object
  if (payload.data.product?.id) {
    return payload.data.product.id;
  }
  return "";
}

/**
 * Helper to get customer ID from payload (handles different formats)
 */
function getCustomerIdFromPayload(
  payload: PolarWebhookPayload
): string | undefined {
  // Direct customerId (camelCase)
  if (payload.data.customerId) {
    return payload.data.customerId;
  }
  // Snake_case (Polar sends this format)
  const snakeData = payload.data as Record<string, unknown>;
  if (snakeData.customer_id && typeof snakeData.customer_id === 'string') {
    return snakeData.customer_id;
  }
  // Nested in customer object
  const customer = payload.data.customer as { id?: string } | undefined;
  if (customer?.id) {
    return customer.id;
  }
  return undefined;
}

function getSubscriptionStatusFromPayload(
  payload: PolarWebhookPayload
): "active" | "canceled" | "past_due" | "none" | undefined {
  const status = payload.data.status;
  if (
    status === "active" ||
    status === "canceled" ||
    status === "past_due" ||
    status === "none"
  ) {
    return status;
  }
  return undefined;
}

/**
 * Map Polar product ID to subscription plan
 * SECURITY: Only allows "plus" or "pro" plans in cloud mode
 * Never returns "unlimited" - that's reserved for self-hosted only
 */
function getPlanFromProductId(productId: string | undefined | null): SubscriptionPlan | null {
  if (!productId) {
    return null;
  }

  const plusProductId = process.env.POLAR_PLUS_PRODUCT_ID;
  const proProductId = process.env.POLAR_PRO_PRODUCT_ID;

  if (productId === plusProductId) return "plus";
  if (productId === proProductId) return "pro";

  console.warn(
    `[Polar] Unknown product ID: ${productId}, refusing to map subscription plan`
  );
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function getPendingUpdateFromPayload(payload: PolarWebhookPayload): {
  productId: string | null;
  appliesAt: Date | null;
} {
  const data = payload.data as Record<string, unknown>;
  const pendingUpdate =
    asRecord(data.pending_update) ?? asRecord(data.pendingUpdate);

  if (!pendingUpdate) {
    return { productId: null, appliesAt: null };
  }

  const productId =
    typeof pendingUpdate.product_id === "string"
      ? pendingUpdate.product_id
      : typeof pendingUpdate.productId === "string"
        ? pendingUpdate.productId
        : null;

  const rawAppliesAt = pendingUpdate.applies_at ?? pendingUpdate.appliesAt;
  const appliesAt =
    rawAppliesAt instanceof Date
      ? rawAppliesAt
      : typeof rawAppliesAt === "string" && rawAppliesAt.length > 0
        ? new Date(rawAppliesAt)
        : null;

  return {
    productId,
    appliesAt: appliesAt && !Number.isNaN(appliesAt.getTime()) ? appliesAt : null,
  };
}

function isFuturePendingProduct(
  payload: PolarWebhookPayload,
  productId: string | undefined | null
): boolean {
  const pendingUpdate = getPendingUpdateFromPayload(payload);
  return Boolean(
    productId &&
      pendingUpdate.productId === productId &&
      pendingUpdate.appliesAt &&
      pendingUpdate.appliesAt.getTime() > Date.now()
  );
}

/**
 * Extract organization ID from webhook payload
 * Checks referenceId in metadata (passed during checkout)
 */
function getOrganizationIdFromPayload(
  payload: PolarWebhookPayload
): string | null {
  // Check direct metadata (subscription events)
  if (payload.data.metadata?.referenceId) {
    return payload.data.metadata.referenceId;
  }
  // Check checkout metadata
  if (payload.data.checkout?.metadata?.referenceId) {
    return payload.data.checkout.metadata.referenceId;
  }
  // Check subscription metadata (for order events)
  const data = payload.data as Record<string, unknown>;
  const subscriptionRecord = asRecord(data.subscription);
  const subscriptionMetadata = asRecord(subscriptionRecord?.metadata);
  if (typeof subscriptionMetadata?.referenceId === "string") {
    return subscriptionMetadata.referenceId;
  }
  return null;
}

/**
 * Find organization by Polar customer ID
 */
async function findOrganizationByCustomerId(customerId: string) {
  const org = await getPolarWebhookDb().query.organization.findFirst({
    where: eq(organization.polarCustomerId, customerId),
  });

  if (!org) {
    console.log(
      `[Polar] Organization not found by polarCustomerId: ${truncateId(customerId)}, will try other methods`
    );
  }

  return org;
}

/**
 * Find organization by user ID (from customer metadata)
 * This is a fallback when polarCustomerId isn't linked yet
 */
async function findOrganizationByUserId(userId: string) {
  // Import member table to find org by user membership
  const { member } = await import("@/db/schema");

  // Find the user's membership and get their organization
  const membership = await getPolarWebhookDb().query.member.findFirst({
    where: and(eq(member.userId, userId), eq(member.role, "org_owner")),
  });

  if (!membership) {
    console.log(`[Polar] No membership found for user: ${truncateId(userId)}`);
    return null;
  }

  // Get the organization
  const org = await getPolarWebhookDb().query.organization.findFirst({
    where: eq(organization.id, membership.organizationId),
  });

  if (org) {
    console.log(
      `[Polar] Found organization ${truncateId(org.id)} via user ${truncateId(userId)}`
    );
    return org;
  }

  console.log(`[Polar] No organization found for user: ${truncateId(userId)}`);
  return null;
}

/**
 * Extract user ID from customer metadata in payload
 */
function getUserIdFromPayload(payload: PolarWebhookPayload): string | null {
  // Check customer metadata.userId
  const customer = payload.data.customer as
    | { metadata?: { userId?: string }; external_id?: string; externalId?: string }
    | undefined;
  if (customer?.metadata?.userId) {
    return customer.metadata.userId;
  }

  // Check customer.external_id (set during customer creation as user.id)
  if (customer?.external_id) {
    return customer.external_id;
  }
  // Also check camelCase version
  if (customer?.externalId) {
    return customer.externalId;
  }

  // Check direct metadata
  const metadata = payload.data.metadata as { userId?: string } | undefined;
  if (metadata?.userId) {
    return metadata.userId;
  }

  return null;
}

/**
 * Find organization by ID (from referenceId)
 */
async function findOrganizationById(orgId: string) {
  const org = await getPolarWebhookDb().query.organization.findFirst({
    where: eq(organization.id, orgId),
  });

  if (!org) {
    console.error(`[Polar] Organization not found for ID: ${orgId}`);
  }

  return org;
}

async function ensureCustomerBinding(
  org: typeof organization.$inferSelect,
  customerId: string | undefined,
  userId: string | null,
  eventType: string,
  webhookEventKey: string
) {
  if (!customerId) {
    await updateWebhookResult(
      webhookEventKey,
      eventType,
      "error",
      "Missing customer ID"
    );
    return false;
  }

  if (org.polarCustomerId) {
    if (org.polarCustomerId === customerId) return true;

    console.error(
      `[Polar] ${eventType}: customer mismatch for org ${truncateId(org.id)}`
    );
    await updateWebhookResult(
      webhookEventKey,
      eventType,
      "error",
      "Polar customer does not match organization billing owner"
    );
    return false;
  }

  if (!userId) {
    await updateWebhookResult(
      webhookEventKey,
      eventType,
      "error",
      "Organization has no customer binding and webhook has no owner identity"
    );
    return false;
  }

  const { member } = await import("@/db/schema");
  const owner = await getPolarWebhookDb().query.member.findFirst({
    where: and(
      eq(member.organizationId, org.id),
      eq(member.userId, userId),
      eq(member.role, "org_owner")
    ),
    columns: { id: true },
  });

  if (!owner) {
    await updateWebhookResult(
      webhookEventKey,
      eventType,
      "error",
      "Webhook customer is not owned by the organization owner"
    );
    return false;
  }

  const linked = await getPolarWebhookDb()
    .update(organization)
    .set({ polarCustomerId: customerId })
    .where(and(eq(organization.id, org.id), isNull(organization.polarCustomerId)))
    .returning({ id: organization.id });

  if (linked.length > 0) return true;

  const current = await getPolarWebhookDb().query.organization.findFirst({
    where: eq(organization.id, org.id),
    columns: { polarCustomerId: true },
  });
  if (current?.polarCustomerId === customerId) return true;

  console.error(
    `[Polar] ${eventType}: customer binding changed while processing org ${truncateId(org.id)}`
  );
  await updateWebhookResult(
    webhookEventKey,
    eventType,
    "error",
    "Organization billing customer changed while processing webhook"
  );
  return false;
}

/**
 * Handle subscription activation
 * Called when a new subscription is activated or renewed
 */
async function processSubscriptionActive(payload: PolarWebhookPayload) {
  const subscriptionId = getSubscriptionIdFromPayload(payload);
  const webhookEventKey = getWebhookEventKey(payload, "subscription.active");

  if (!subscriptionId) {
    console.error("[Polar] subscription.active missing subscription ID");
    await updateWebhookResult(
      webhookEventKey,
      "subscription.active",
      "error",
      "Missing subscription ID"
    );
    return;
  }

  // Atomic idempotency: Try to claim this webhook for processing
  // If another instance already claimed it, skip processing
  if (!(await tryClaimWebhook(webhookEventKey, "subscription.active"))) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookEventKey)} already claimed/processed, skipping`
    );
    return;
  }

  const customerId = getCustomerIdFromPayload(payload);
  const productId = getProductIdFromPayload(payload);
  const orgId = getOrganizationIdFromPayload(payload);
  const userId = getUserIdFromPayload(payload);
  const subscriptionDates = getSubscriptionDatesFromPayload(payload);

  // Try multiple methods to find the organization
  let org = orgId ? await findOrganizationById(orgId) : null;

  if (!org && customerId) {
    org = await findOrganizationByCustomerId(customerId);
  }

  // Fallback: find by user ID from customer metadata
  if (!org && userId) {
    org = await findOrganizationByUserId(userId);
    // If found via userId, also link the polarCustomerId for future lookups
    // SECURITY: Use conditional update to prevent race condition
    if (org && customerId && !org.polarCustomerId) {
      console.log(
        `[Polar] Linking customer ${truncateId(customerId)} to org ${truncateId(org.id)}`
      );
      await getPolarWebhookDb()
        .update(organization)
        .set({ polarCustomerId: customerId })
        .where(
          and(eq(organization.id, org.id), isNull(organization.polarCustomerId))
        );
    }
  }

  if (!org) {
    console.error(
      `[Polar] Org not found for subscription (orgRef: ${truncateId(orgId)}, customer: ${truncateId(customerId)}, user: ${truncateId(userId)})`
    );
    await updateWebhookResult(
      webhookEventKey,
      "subscription.active",
      "error",
      "Organization not found"
    );
    return;
  }

  if (
    !(await ensureCustomerBinding(
      org,
      customerId,
      userId,
      "subscription.active",
      webhookEventKey
    ))
  ) {
    return;
  }

  // Additional idempotency: Skip if already active with same subscription
  if (
    org.subscriptionStatus === "active" &&
    org.subscriptionId === subscriptionId &&
    org.polarCustomerId === customerId &&
    isSameBillingPeriod(org, subscriptionDates)
  ) {
    console.log(
      `[Polar] Subscription already active for ${truncateId(org.id)}, skipping`
    );
    await updateWebhookResult(
      webhookEventKey,
      "subscription.active",
      "skipped",
      "Already active"
    );
    return;
  }

  const plan = getPlanFromProductId(productId);
  if (!plan) {
    await updateWebhookResult(
      webhookEventKey,
      "subscription.active",
      "error",
      `Unknown product ID: ${productId || "missing"}`
    );
    return;
  }

  await subscriptionService.updateSubscription(org.id, {
    subscriptionPlan: plan,
    subscriptionStatus: "active",
    subscriptionId,
    polarCustomerId: customerId,
    // Pass Polar subscription dates for accurate billing period
    subscriptionStartedAt: subscriptionDates.startsAt,
    subscriptionEndsAt: subscriptionDates.endsAt,
  }, getPolarWebhookDb(org.id));

  // Reset usage counters using Polar's subscription dates (not calendar months)
  const reset = await subscriptionService.resetUsageCountersWithDates(
    org.id,
    subscriptionDates.startsAt,
    subscriptionDates.endsAt,
    getPolarWebhookDb(org.id)
  );

  if (reset) {
    await billingSettingsService.resetNotificationsForPeriod(org.id, getPolarWebhookDb(org.id));
  }

  console.log(`[Polar] ✅ Activated ${plan} for org ${truncateId(org.id)}`);

  // Mark webhook as successfully processed
  await updateWebhookResult(webhookEventKey, "subscription.active", "success", `Activated ${plan}`);
}

/**
 * Handle subscription creation.
 * Creation alone is not a paid access signal. Entitlements are granted by
 * subscription.active, where Polar confirms the subscription is
 * active/paid.
 */
export async function handleSubscriptionCreated(payload: PolarWebhookPayload) {
  const webhookEventKey = getWebhookEventKey(payload, "subscription.created");

  if (!(await tryClaimWebhook(webhookEventKey, "subscription.created"))) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookEventKey)} already claimed/processed, skipping`
    );
    return;
  }

  await updateWebhookResult(
    webhookEventKey,
    "subscription.created",
    "success",
    "Subscription created acknowledged; waiting for subscription.active"
  );
}

/**
 * Handle subscription updates
 * Called when subscription plan changes or status updates
 *
 * Plan change scenarios:
 * - Upgrade (Plus → Pro): Usually takes effect immediately with prorated billing
 * - Downgrade (Pro → Plus): Usually takes effect at end of current billing period
 *
 * The new limits are applied immediately based on the new plan
 */
async function processSubscriptionUpdated(payload: PolarWebhookPayload) {
  const subscriptionId = getSubscriptionIdFromPayload(payload);
  const webhookEventKey = getWebhookEventKey(payload, "subscription.updated");

  if (!subscriptionId) {
    console.error("[Polar] subscription.updated missing subscription ID");
    await updateWebhookResult(
      webhookEventKey,
      "subscription.updated",
      "error",
      "Missing subscription ID"
    );
    return;
  }

  // Atomic idempotency: Try to claim this webhook for processing
  if (!(await tryClaimWebhook(webhookEventKey, "subscription.updated"))) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookEventKey)} already claimed/processed, skipping`
    );
    return;
  }

  const productId = getProductIdFromPayload(payload);
  const customerId = getCustomerIdFromPayload(payload);
  const userId = getUserIdFromPayload(payload);
  const subscriptionDates = getSubscriptionDatesFromPayload(payload);

  // Try to find organization by subscription ID first
  let org = await getPolarWebhookDb().query.organization.findFirst({
    where: eq(organization.subscriptionId, subscriptionId),
  });

  // If not found by subscription ID, try by customer ID (handles plan change scenarios)
  if (!org && customerId) {
    org = await findOrganizationByCustomerId(customerId);
  }

  // If still not found, try by referenceId in metadata
  if (!org) {
    const orgId = getOrganizationIdFromPayload(payload);
    if (orgId) {
      org = await findOrganizationById(orgId);
    }
  }

  if (!org) {
    console.warn(
      `[Polar] subscription.updated: No org found for subscription ${truncateId(subscriptionId)}`
    );
    await updateWebhookResult(
      webhookEventKey,
      "subscription.updated",
      "error",
      "Organization not found"
    );
    return;
  }

  if (
    !(await ensureCustomerBinding(
      org,
      customerId,
      userId,
      "subscription.updated",
      webhookEventKey
    ))
  ) {
    return;
  }

  const status = getSubscriptionStatusFromPayload(payload);
  const mappedPlan = productId ? getPlanFromProductId(productId) : null;
  if (productId && !mappedPlan) {
    await updateWebhookResult(
      webhookEventKey,
      "subscription.updated",
      "error",
      `Unknown product ID: ${productId}`
    );
    return;
  }

  const shouldDeferPlanChange = isFuturePendingProduct(payload, productId);
  const newPlan: SubscriptionPlan | null =
    mappedPlan && !shouldDeferPlanChange
      ? mappedPlan
      : org.subscriptionPlan === "plus" || org.subscriptionPlan === "pro"
        ? org.subscriptionPlan
        : null;
  const oldPlan = org.subscriptionPlan;

  // Log plan change for monitoring
  if (oldPlan && oldPlan !== newPlan) {
    console.log(
      `[Polar] Plan change detected: ${oldPlan} → ${newPlan} for org ${truncateId(org.id)}`
    );
  }

  // Update subscription with new plan and dates. Only overwrite dates when
  // Polar included them; some catch-all updates do not carry full period data.
  await subscriptionService.updateSubscription(org.id, {
    ...(newPlan ? { subscriptionPlan: newPlan } : {}),
    ...(status ? { subscriptionStatus: status } : {}),
    subscriptionId,
    ...(customerId ? { polarCustomerId: customerId } : {}),
    ...(subscriptionDates.startsAt
      ? { subscriptionStartedAt: subscriptionDates.startsAt }
      : {}),
    ...(subscriptionDates.endsAt
      ? { subscriptionEndsAt: subscriptionDates.endsAt }
      : {}),
  }, getPolarWebhookDb(org.id));

  await resetUsageForNewBillingPeriod(
    org,
    subscriptionDates,
    "subscription.updated"
  );

  console.log(
    `[Polar] ✅ Updated ${newPlan || "existing"}/${status} for org ${truncateId(org.id)}${shouldDeferPlanChange ? " (pending plan change deferred)" : ""}`
  );

  // Mark webhook as successfully processed
  await updateWebhookResult(webhookEventKey, "subscription.updated", "success", `Updated to ${newPlan || "existing"}/${status}`);
}

/**
 * Handle subscription cancellation
 * Subscription remains active until end of billing period
 * IMPORTANT: User should retain access until subscriptionEndsAt date
 */
async function processSubscriptionCanceled(payload: PolarWebhookPayload) {
  const subscriptionId = getSubscriptionIdFromPayload(payload);
  const webhookEventKey = getWebhookEventKey(payload, "subscription.canceled");

  if (!subscriptionId) {
    console.error("[Polar] subscription.canceled missing subscription ID");
    await updateWebhookResult(
      webhookEventKey,
      "subscription.canceled",
      "error",
      "Missing subscription ID"
    );
    return;
  }

  // Atomic idempotency: Try to claim this webhook for processing
  if (!(await tryClaimWebhook(webhookEventKey, "subscription.canceled"))) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookEventKey)} already claimed/processed, skipping`
    );
    return;
  }

  const org = await getPolarWebhookDb().query.organization.findFirst({
    where: eq(organization.subscriptionId, subscriptionId),
  });

  if (!org) {
    await updateWebhookResult(
      webhookEventKey,
      "subscription.canceled",
      "error",
      "Organization not found"
    );
    return;
  }

  // Get subscription end date from payload - user keeps access until this date
  const subscriptionDates = getSubscriptionDatesFromPayload(payload);

  await subscriptionService.updateSubscription(org.id, {
    subscriptionStatus: "canceled",
    // Preserve the end date - access continues until this date
    ...(subscriptionDates.endsAt
      ? { subscriptionEndsAt: subscriptionDates.endsAt }
      : {}),
  }, getPolarWebhookDb(org.id));

  console.log(
    `[Polar] ✅ Canceled subscription for org ${truncateId(org.id)} (access until ${subscriptionDates.endsAt?.toISOString() || org.subscriptionEndsAt?.toISOString() || "period end"})`
  );

  // Mark webhook as successfully processed
  await updateWebhookResult(webhookEventKey, "subscription.canceled", "success", "Subscription canceled");
}

/**
 * Handle subscription past-due status.
 * Polar sends this when renewal payment fails. Access remains available while
 * Polar's recovery flow runs; revocation is handled by subscription.revoked.
 */
async function processSubscriptionPastDue(payload: PolarWebhookPayload) {
  const subscriptionId = getSubscriptionIdFromPayload(payload);
  const webhookEventKey = getWebhookEventKey(payload, "subscription.past_due");

  if (!subscriptionId) {
    console.error("[Polar] subscription.past_due missing subscription ID");
    await updateWebhookResult(
      webhookEventKey,
      "subscription.past_due",
      "error",
      "Missing subscription ID"
    );
    return;
  }

  if (!(await tryClaimWebhook(webhookEventKey, "subscription.past_due"))) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookEventKey)} already claimed/processed, skipping`
    );
    return;
  }

  const customerId = getCustomerIdFromPayload(payload);
  const productId = getProductIdFromPayload(payload);
  const userId = getUserIdFromPayload(payload);
  const subscriptionDates = getSubscriptionDatesFromPayload(payload);

  let org = await getPolarWebhookDb().query.organization.findFirst({
    where: eq(organization.subscriptionId, subscriptionId),
  });

  if (!org && customerId) {
    org = await findOrganizationByCustomerId(customerId);
  }

  if (!org) {
    const orgId = getOrganizationIdFromPayload(payload);
    if (orgId) {
      org = await findOrganizationById(orgId);
    }
  }

  if (!org) {
    await updateWebhookResult(
      webhookEventKey,
      "subscription.past_due",
      "error",
      "Organization not found"
    );
    return;
  }

  if (
    !(await ensureCustomerBinding(
      org,
      customerId,
      userId,
      "subscription.past_due",
      webhookEventKey
    ))
  ) {
    return;
  }

  const plan = getPlanFromProductId(productId);
  if (productId && !plan) {
    await updateWebhookResult(
      webhookEventKey,
      "subscription.past_due",
      "error",
      `Unknown product ID: ${productId}`
    );
    return;
  }

  await subscriptionService.updateSubscription(org.id, {
    ...(plan ? { subscriptionPlan: plan } : {}),
    subscriptionStatus: "past_due",
    subscriptionId,
    ...(customerId ? { polarCustomerId: customerId } : {}),
    ...(subscriptionDates.startsAt
      ? { subscriptionStartedAt: subscriptionDates.startsAt }
      : {}),
    ...(subscriptionDates.endsAt
      ? { subscriptionEndsAt: subscriptionDates.endsAt }
      : {}),
  }, getPolarWebhookDb(org.id));

  await resetUsageForNewBillingPeriod(
    org,
    subscriptionDates,
    "subscription.past_due"
  );

  console.log(
    `[Polar] ⚠️ Marked subscription past_due for org ${truncateId(org.id)}`
  );

  await updateWebhookResult(
    webhookEventKey,
    "subscription.past_due",
    "success",
    "Subscription marked past_due"
  );
}

/**
 * Handle subscription revocation
 * CRITICAL: Unlike cancellation, revocation means IMMEDIATE access termination
 * This happens when payment fails permanently, fraud is detected, or admin action
 */
async function processSubscriptionRevoked(payload: PolarWebhookPayload) {
  const subscriptionId = getSubscriptionIdFromPayload(payload);
  const webhookEventKey = getWebhookEventKey(payload, "subscription.revoked");

  if (!subscriptionId) {
    console.error("[Polar] subscription.revoked missing subscription ID");
    await updateWebhookResult(
      webhookEventKey,
      "subscription.revoked",
      "error",
      "Missing subscription ID"
    );
    return;
  }

  // Atomic idempotency: Try to claim this webhook for processing
  if (!(await tryClaimWebhook(webhookEventKey, "subscription.revoked"))) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookEventKey)} already claimed/processed, skipping`
    );
    return;
  }

  const org = await getPolarWebhookDb().query.organization.findFirst({
    where: eq(organization.subscriptionId, subscriptionId),
  });

  if (!org) {
    console.log(
      `[Polar] subscription.revoked: No org found for subscription ${truncateId(subscriptionId)}`
    );
    await updateWebhookResult(
      webhookEventKey,
      "subscription.revoked",
      "error",
      "Organization not found"
    );
    return;
  }

  // CRITICAL: Immediately revoke access by setting status to 'none'
  await subscriptionService.updateSubscription(org.id, {
    subscriptionStatus: "none",
    subscriptionPlan: null, // Clear plan on revocation
  }, getPolarWebhookDb(org.id));

  console.log(
    `[Polar] ⚠️ REVOKED subscription for org ${truncateId(org.id)} - access terminated immediately`
  );

  // Mark webhook as successfully processed
  await updateWebhookResult(webhookEventKey, "subscription.revoked", "success", "Subscription revoked");
}

/**
 * Handle order creation
 * Order creation does not guarantee paid status; only logs receipt.
 */
export async function handleOrderCreated(payload: PolarWebhookPayload) {
  const webhookEventKey = getWebhookEventKey(payload, "order.created");

  if (!(await tryClaimWebhook(webhookEventKey, "order.created"))) {
    return;
  }

  await updateWebhookResult(
    webhookEventKey,
    "order.created",
    "success",
    "Order created acknowledged"
  );
}

/**
 * Handle order paid events
 * Can be used for one-time payments or subscription renewals
 */
async function processOrderPaid(payload: PolarWebhookPayload) {
  const webhookEventKey = getWebhookEventKey(payload, "order.paid");

  // Atomic idempotency: Try to claim this webhook for processing
  if (!(await tryClaimWebhook(webhookEventKey, "order.paid"))) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookEventKey)} already claimed/processed, skipping`
    );
    return;
  }

  const customerId = getCustomerIdFromPayload(payload);
  const productId = getProductIdFromPayload(payload);
  const orgId = getOrganizationIdFromPayload(payload);
  const userId = getUserIdFromPayload(payload);
  const orderData = payload.data as Record<string, unknown>;
  const orderSubscription = asRecord(orderData.subscription);
  const subscriptionId =
    (typeof orderSubscription?.id === "string" && orderSubscription.id) ||
    (typeof orderData.subscriptionId === "string" && orderData.subscriptionId) ||
    (typeof orderData.subscription_id === "string" && orderData.subscription_id) ||
    null;
  const subscriptionDates = getSubscriptionDatesFromPayload(payload);

  let org = subscriptionId
    ? await getPolarWebhookDb().query.organization.findFirst({
        where: eq(organization.subscriptionId, subscriptionId),
      })
    : null;

  if (!org && orgId) {
    org = await findOrganizationById(orgId);
  }

  // Fallback to customerId lookup
  if (!org && customerId) {
    org = await findOrganizationByCustomerId(customerId);
  }

  // Fallback: find by user ID from customer metadata
  if (!org && userId) {
    org = await findOrganizationByUserId(userId);
    // If found via userId, also link the polarCustomerId for future lookups
    // SECURITY: Use conditional update to prevent race condition
    if (org && customerId && !org.polarCustomerId) {
      console.log(
        `[Polar] Linking customer ${truncateId(customerId)} to org ${truncateId(org.id)}`
      );
      await getPolarWebhookDb()
        .update(organization)
        .set({ polarCustomerId: customerId })
        .where(
          and(eq(organization.id, org.id), isNull(organization.polarCustomerId))
        );
    }
  }

  if (!org) {
    console.error(
      `[Polar] Org not found for order (orgRef: ${truncateId(orgId)}, customer: ${truncateId(customerId)}, user: ${truncateId(userId)})`
    );
    await updateWebhookResult(
      webhookEventKey,
      "order.paid",
      "error",
      "Organization not found"
    );
    return;
  }

  if (
    !(await ensureCustomerBinding(
      org,
      customerId,
      userId,
      "order.paid",
      webhookEventKey
    ))
  ) {
    return;
  }

  // If this is a subscription product or subscription renewal, activate/sync it.
  if (productId || subscriptionId) {
    const plan = getPlanFromProductId(productId);
    if (productId && !plan) {
      await updateWebhookResult(
        webhookEventKey,
        "order.paid",
        "error",
        `Unknown product ID: ${productId}`
      );
      return;
    }

    // A paid invoice is not a current subscription snapshot. It must not undo
    // cancellation/revocation or overwrite a plan with the invoice's old plan.
    // Wait for the authoritative lifecycle event when activation is still pending.
    if (!subscriptionId || org.subscriptionId !== subscriptionId) {
      await updateWebhookResult(webhookEventKey, "order.paid", "error",
        "Waiting for subscription lifecycle event before applying payment");
      return;
    }

    const reset = await resetUsageForNewBillingPeriod(
      org,
      subscriptionDates,
      "order.paid"
    );

    console.log(
      `[Polar] ✅ Order recorded for org ${truncateId(org.id)}${reset ? " with usage reset" : ""}`
    );

    // Mark webhook as successfully processed
    await updateWebhookResult(
      webhookEventKey,
      "order.paid",
      "success",
      "Order recorded; subscription state managed by lifecycle events"
    );
  } else {
    // No product ID - just mark as processed
    await updateWebhookResult(webhookEventKey, "order.paid", "success", "Order processed (no product)");
  }
}

/**
 * Handle customer creation
 * Links the new Polar customer to the user's organization
 * This is critical for the checkout flow to work correctly
 */
export async function handleCustomerCreated(payload: PolarWebhookPayload) {
  const customerId = payload.data.id;

  if (!customerId) {
    console.error("[Polar] customer.created webhook missing customer ID");
    return;
  }

  // Get userId from customer metadata or externalId
  // The Polar plugin sets externalId = user.id when creating customers
  const customerData = payload.data as Record<string, unknown>;
  const customerMetadata = asRecord(customerData.metadata);
  const externalId =
    typeof customerData.externalId === "string"
      ? customerData.externalId
      : typeof customerData.external_id === "string"
        ? customerData.external_id
        : null;
  const metadataUserId =
    typeof customerMetadata?.userId === "string"
      ? customerMetadata.userId
      : null;
  const userId = externalId || metadataUserId;

  if (!userId) {
    console.log(
      `[Polar] customer.created: No userId found in payload for customer ${truncateId(customerId)}`
    );
    return;
  }

  console.log(
    `[Polar] customer.created: Linking customer ${truncateId(customerId)} to user ${truncateId(userId)}`
  );

  // Find the user's organization
  const org = await findOrganizationByUserId(userId);

  if (!org) {
    console.log(
      `[Polar] customer.created: No organization found for user ${truncateId(userId)}`
    );
    return;
  }

  // Link customer to organization if not already linked
  // SECURITY: Use conditional update to prevent race condition where
  // another customer ID could be linked between check and update
  if (!org.polarCustomerId) {
    const result = await getPolarWebhookDb()
      .update(organization)
      .set({ polarCustomerId: customerId })
      .where(
        and(eq(organization.id, org.id), isNull(organization.polarCustomerId))
      )
      .returning();

    if (result.length > 0) {
      console.log(
        `[Polar] ✅ customer.created: Linked customer ${truncateId(customerId)} to org ${truncateId(org.id)}`
      );
    } else {
      // Another process already linked a customer
      console.log(
        `[Polar] customer.created: Org ${truncateId(org.id)} already has a customer linked (race condition avoided)`
      );
    }
  } else if (org.polarCustomerId !== customerId) {
    console.log(
      `[Polar] customer.created: Org ${truncateId(org.id)} already has different customer ${truncateId(org.polarCustomerId)}`
    );
  } else {
    console.log(
      `[Polar] customer.created: Org ${truncateId(org.id)} already linked to customer ${truncateId(customerId)}`
    );
  }
}

/**
 * Handle subscription uncancellation
 * Called when a subscription cancellation is reversed (user re-subscribes during grace period)
 * Per Polar docs: "Triggered when a subscription cancellation is reversed"
 */
async function processSubscriptionUncanceled(
  payload: PolarWebhookPayload
) {
  const subscriptionId = getSubscriptionIdFromPayload(payload);
  const webhookEventKey = getWebhookEventKey(payload, "subscription.uncanceled");

  if (!subscriptionId) {
    console.error("[Polar] subscription.uncanceled missing subscription ID");
    await updateWebhookResult(
      webhookEventKey,
      "subscription.uncanceled",
      "error",
      "Missing subscription ID"
    );
    return;
  }

  // Atomic idempotency: Try to claim this webhook for processing
  if (!(await tryClaimWebhook(webhookEventKey, "subscription.uncanceled"))) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookEventKey)} already claimed/processed, skipping`
    );
    return;
  }

  const customerId = getCustomerIdFromPayload(payload);
  const productId = getProductIdFromPayload(payload);
  const orgId = getOrganizationIdFromPayload(payload);
  const userId = getUserIdFromPayload(payload);

  // Try to find organization
  let org = orgId ? await findOrganizationById(orgId) : null;

  if (!org && customerId) {
    org = await findOrganizationByCustomerId(customerId);
  }

  if (!org) {
    console.error(
      `[Polar] Org not found for uncanceled subscription (orgRef: ${truncateId(orgId)}, customer: ${truncateId(customerId)})`
    );
    await updateWebhookResult(
      webhookEventKey,
      "subscription.uncanceled",
      "error",
      "Organization not found"
    );
    return;
  }

  if (
    !(await ensureCustomerBinding(
      org,
      customerId,
      userId,
      "subscription.uncanceled",
      webhookEventKey
    ))
  ) {
    return;
  }

  const plan = getPlanFromProductId(productId);
  if (!plan) {
    await updateWebhookResult(
      webhookEventKey,
      "subscription.uncanceled",
      "error",
      `Unknown product ID: ${productId || "missing"}`
    );
    return;
  }
  const subscriptionDates = getSubscriptionDatesFromPayload(payload);

  // Restore subscription to active status
  // The subscription was canceled but now it's back to active
  await subscriptionService.updateSubscription(org.id, {
    subscriptionPlan: plan,
    subscriptionStatus: "active",
    subscriptionId,
    polarCustomerId: customerId,
    // Update dates from payload
    subscriptionStartedAt: subscriptionDates.startsAt,
    subscriptionEndsAt: subscriptionDates.endsAt,
  }, getPolarWebhookDb(org.id));

  console.log(
    `[Polar] ✅ UNCANCELED subscription restored for org ${truncateId(org.id)} - ${plan} plan`
  );

  await updateWebhookResult(
    webhookEventKey,
    "subscription.uncanceled",
    "success",
    `Restored to ${plan}`
  );
}

/**
 * Handle customer state changes
 * Aggregated event for any customer-related changes
 */
export async function handleCustomerStateChanged() {
  // Customer state changes are handled by subscription events
}

/**
 * Handle customer deletion
 * CRITICAL: Revokes subscription when customer is deleted from Polar
 * This prevents users from accessing resources after being deleted from Polar
 */
async function processCustomerDeleted(payload: PolarWebhookPayload) {
  const customerId = payload.data.id;

  if (!customerId) {
    console.error("[Polar] customer.deleted webhook missing customer ID");
    return;
  }

  console.log(
    `[Polar] customer.deleted: Processing deletion for customer ${truncateId(customerId)}`
  );

  // Find organization by Polar customer ID
  const org = await getPolarWebhookDb().query.organization.findFirst({
    where: eq(organization.polarCustomerId, customerId),
  });

  if (!org) {
    console.log(
      `[Polar] customer.deleted: No organization found for customer ${truncateId(customerId)}`
    );
    return;
  }

  // CRITICAL: Revoke subscription immediately
  // Set subscription to 'none' status and clear the plan
  // Consistent with handleSubscriptionRevoked which also clears the plan
  await getPolarWebhookDb()
    .update(organization)
    .set({
      subscriptionStatus: "none",
      subscriptionPlan: null, // Clear plan on customer deletion (matches revocation behavior)
      // Keep polarCustomerId for audit trail
      // The validatePolarCustomer check will also fail since customer doesn't exist in Polar
    })
    .where(eq(organization.id, org.id));

  console.log(
    `[Polar] ✅ customer.deleted: Revoked subscription for org ${truncateId(org.id)} (customer: ${truncateId(customerId)})`
  );
}

/**
 * Resolve the tenant before locking, then rerun all handler reads inside the
 * transaction. The service boundary verifies the handler uses this same tenant.
 * Only signature-verified Polar SDK callbacks may call these handlers.
 */
function orderedHandler(eventType: string, handler: (payload: PolarWebhookPayload) => Promise<void>) {
  return async (payload: PolarWebhookPayload) => {
    const data = payload.data;
    const subscription = asRecord(data.subscription);
    const subscriptionId = eventType.startsWith("subscription.")
      ? getSubscriptionIdFromPayload(payload) ?? null
      : eventType === "order.paid"
        ? (typeof subscription?.id === "string" ? subscription.id :
          typeof data.subscriptionId === "string" ? data.subscriptionId :
          typeof data.subscription_id === "string" ? data.subscription_id : null)
        : null;
    const customerId = eventType === "customer.deleted" ? data.id : getCustomerIdFromPayload(payload);
    const orgId = getOrganizationIdFromPayload(payload);
    const userId = getUserIdFromPayload(payload);
    let org: typeof organization.$inferSelect | null | undefined = subscriptionId
      ? await getPolarWebhookDb().query.organization.findFirst({ where: eq(organization.subscriptionId, subscriptionId) })
      : undefined;
    if (!org && orgId) org = await findOrganizationById(orgId);
    if (!org && customerId) org = await findOrganizationByCustomerId(customerId);
    if (!org && userId) org = await findOrganizationByUserId(userId);
    if (!org) {
      if (eventType === "customer.deleted") return;
      throw new Error("Polar billing organization not found");
    }
    await runOrderedPolarEvent({
      organizationId: org.id,
      timestamp: payload.timestamp,
      eventKey: eventType + ":" + getWebhookEventKey(payload, eventType),
      subscriptionId,
      canReplaceSubscription: eventType === "subscription.active",
      periodStart: getSubscriptionDatesFromPayload(payload).startsAt,
      affectsSubscriptionState: eventType !== "order.paid",
    }, () => handler(payload));
  };
}

export const handleSubscriptionActive = orderedHandler("subscription.active", processSubscriptionActive);

export const handleSubscriptionUpdated = orderedHandler("subscription.updated", processSubscriptionUpdated);

export const handleSubscriptionCanceled = orderedHandler("subscription.canceled", processSubscriptionCanceled);

export const handleSubscriptionPastDue = orderedHandler("subscription.past_due", processSubscriptionPastDue);

export const handleSubscriptionRevoked = orderedHandler("subscription.revoked", processSubscriptionRevoked);

export const handleOrderPaid = orderedHandler("order.paid", processOrderPaid);

export const handleSubscriptionUncanceled = orderedHandler("subscription.uncanceled", processSubscriptionUncanceled);

export const handleCustomerDeleted = orderedHandler("customer.deleted", processCustomerDeleted);
