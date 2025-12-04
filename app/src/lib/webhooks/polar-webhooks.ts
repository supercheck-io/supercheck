/**
 * Polar Webhook Handlers
 * Process incoming webhook events from Polar for subscription management
 *
 * Security & Reliability:
 * - Idempotency: Database-backed to handle multi-instance deployments
 * - Logging: Uses truncated IDs to avoid leaking sensitive data
 * - Error handling: Graceful degradation on non-critical failures
 */

import { subscriptionService } from "@/lib/services/subscription-service";
import { billingSettingsService } from "@/lib/services/billing-settings.service";
import { db } from "@/utils/db";
import { organization, webhookIdempotency } from "@/db/schema";
import { eq, and, lt } from "drizzle-orm";
import type { SubscriptionPlan } from "@/db/schema";

// Idempotency TTL: 24 hours
const WEBHOOK_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Check if a webhook has already been processed (idempotency)
 * Uses database for multi-instance deployments
 * Returns true if already processed, false if new
 */
async function isWebhookProcessed(
  webhookId: string,
  eventType: string
): Promise<boolean> {
  try {
    const existing = await db.query.webhookIdempotency.findFirst({
      where: and(
        eq(webhookIdempotency.webhookId, webhookId),
        eq(webhookIdempotency.eventType, eventType)
      ),
    });

    return !!existing;
  } catch (error) {
    // If table doesn't exist yet (pre-migration), fall back to allowing processing
    // This prevents blocking webhooks during migration period
    console.warn(
      `[Polar] Idempotency check failed (table may not exist yet): ${error}`
    );
    return false;
  }
}

/**
 * Mark a webhook as processed
 * Stores in database with TTL for cleanup
 */
async function markWebhookProcessed(
  webhookId: string,
  eventType: string,
  status: "success" | "error" | "skipped" = "success",
  message?: string
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + WEBHOOK_IDEMPOTENCY_TTL_MS);

    await db.insert(webhookIdempotency).values({
      webhookId,
      eventType,
      resultStatus: status,
      resultMessage: message,
      expiresAt,
    });
  } catch (error) {
    // Log but don't fail - idempotency is a safety measure, not critical path
    console.warn(`[Polar] Failed to mark webhook as processed: ${error}`);
  }
}

/**
 * Clean up expired webhook idempotency records
 * Should be called periodically (e.g., via cron job)
 */
export async function cleanupExpiredWebhooks(): Promise<number> {
  try {
    const now = new Date();
    const result = await db
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
  type?: string;
  data: {
    id: string;
    // Polar uses camelCase
    customerId?: string;
    productId?: string;
    status?: string;
    // Subscription billing period dates from Polar
    startsAt?: string; // ISO date when subscription period starts
    endsAt?: string; // ISO date when subscription period ends
    currentPeriodStart?: string; // Alternative field name
    currentPeriodEnd?: string; // Alternative field name
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
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Helper to get subscription period dates from payload
 * Returns the billing cycle start and end dates from Polar
 */
function getSubscriptionDatesFromPayload(payload: PolarWebhookPayload): {
  startsAt: Date | null;
  endsAt: Date | null;
} {
  // Try direct fields first (subscription events)
  let startsAt: Date | null = null;
  let endsAt: Date | null = null;

  // Try startsAt/endsAt (most common in subscription events)
  if (payload.data.startsAt) {
    startsAt = new Date(payload.data.startsAt);
  }
  if (payload.data.endsAt) {
    endsAt = new Date(payload.data.endsAt);
  }

  // Try currentPeriodStart/currentPeriodEnd (alternative naming)
  if (!startsAt && payload.data.currentPeriodStart) {
    startsAt = new Date(payload.data.currentPeriodStart);
  }
  if (!endsAt && payload.data.currentPeriodEnd) {
    endsAt = new Date(payload.data.currentPeriodEnd);
  }

  // Validate dates are valid
  if (startsAt && isNaN(startsAt.getTime())) startsAt = null;
  if (endsAt && isNaN(endsAt.getTime())) endsAt = null;

  return { startsAt, endsAt };
}

/**
 * Helper to get product ID from payload (handles different webhook formats)
 */
function getProductIdFromPayload(payload: PolarWebhookPayload): string {
  // Direct productId
  if (payload.data.productId) {
    return payload.data.productId;
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
  // Direct customerId
  if (payload.data.customerId) {
    return payload.data.customerId;
  }
  // Nested in customer object
  const customer = payload.data.customer as { id?: string } | undefined;
  if (customer?.id) {
    return customer.id;
  }
  return undefined;
}

/**
 * Map Polar product ID to subscription plan
 * SECURITY: Only allows "plus" or "pro" plans in cloud mode
 * Never returns "unlimited" - that's reserved for self-hosted only
 */
function getPlanFromProductId(productId: string): SubscriptionPlan {
  const plusProductId = process.env.POLAR_PLUS_PRODUCT_ID;
  const proProductId = process.env.POLAR_PRO_PRODUCT_ID;

  if (productId === plusProductId) return "plus";
  if (productId === proProductId) return "pro";

  // SECURITY: Default to plus for unknown products - never unlimited
  console.warn(
    `[Polar] Unknown product ID: ${productId}, defaulting to plus plan`
  );
  return "plus";
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
  const subscription = (payload.data as any).subscription; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (subscription?.metadata?.referenceId) {
    return subscription.metadata.referenceId;
  }
  // Check product metadata
  const product = (payload.data as any).product; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (product?.metadata?.referenceId) {
    return product.metadata.referenceId;
  }
  return null;
}

/**
 * Find organization by Polar customer ID
 */
async function findOrganizationByCustomerId(customerId: string) {
  const org = await db.query.organization.findFirst({
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
  const membership = await db.query.member.findFirst({
    where: eq(member.userId, userId),
  });

  if (!membership) {
    console.log(`[Polar] No membership found for user: ${truncateId(userId)}`);
    return null;
  }

  // Get the organization
  const org = await db.query.organization.findFirst({
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
  // Check customer metadata
  const customer = payload.data.customer as
    | { metadata?: { userId?: string } }
    | undefined;
  if (customer?.metadata?.userId) {
    return customer.metadata.userId;
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
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, orgId),
  });

  if (!org) {
    console.error(`[Polar] Organization not found for ID: ${orgId}`);
  }

  return org;
}

/**
 * Handle subscription activation
 * Called when a new subscription is activated or renewed
 */
export async function handleSubscriptionActive(payload: PolarWebhookPayload) {
  const webhookId = payload.data.id;

  // Idempotency check: Skip if already processed this webhook
  if (await isWebhookProcessed(webhookId, "subscription.active")) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookId)} already processed, skipping`
    );
    return;
  }

  const customerId = getCustomerIdFromPayload(payload);
  const productId = getProductIdFromPayload(payload);
  const orgId = getOrganizationIdFromPayload(payload);
  const userId = getUserIdFromPayload(payload);

  // Try multiple methods to find the organization
  let org = orgId ? await findOrganizationById(orgId) : null;

  if (!org && customerId) {
    org = await findOrganizationByCustomerId(customerId);
  }

  // Fallback: find by user ID from customer metadata
  if (!org && userId) {
    org = await findOrganizationByUserId(userId);
    // If found via userId, also link the polarCustomerId for future lookups
    if (org && customerId && !org.polarCustomerId) {
      console.log(
        `[Polar] Linking customer ${truncateId(customerId)} to org ${truncateId(org.id)}`
      );
      await db
        .update(organization)
        .set({ polarCustomerId: customerId })
        .where(eq(organization.id, org.id));
    }
  }

  if (!org) {
    console.error(
      `[Polar] Org not found for subscription (orgRef: ${truncateId(orgId)}, customer: ${truncateId(customerId)}, user: ${truncateId(userId)})`
    );
    return;
  }

  // Additional idempotency: Skip if already active with same subscription
  if (
    org.subscriptionStatus === "active" &&
    org.subscriptionId === webhookId &&
    org.polarCustomerId === customerId
  ) {
    console.log(
      `[Polar] Subscription already active for ${truncateId(org.id)}, skipping`
    );
    await markWebhookProcessed(
      webhookId,
      "subscription.active",
      "skipped",
      "Already active"
    );
    return;
  }

  const plan = getPlanFromProductId(productId);
  const subscriptionDates = getSubscriptionDatesFromPayload(payload);

  await subscriptionService.updateSubscription(org.id, {
    subscriptionPlan: plan,
    subscriptionStatus: "active",
    subscriptionId: webhookId,
    polarCustomerId: customerId,
    // Pass Polar subscription dates for accurate billing period
    subscriptionStartedAt: subscriptionDates.startsAt,
    subscriptionEndsAt: subscriptionDates.endsAt,
  });

  // Reset usage counters using Polar's subscription dates (not calendar months)
  await subscriptionService.resetUsageCountersWithDates(
    org.id,
    subscriptionDates.startsAt,
    subscriptionDates.endsAt
  );

  try {
    await billingSettingsService.resetNotificationsForPeriod(org.id);
  } catch {
    // Ignore if billing_settings table doesn't exist
  }

  // Mark webhook as processed after successful handling
  await markWebhookProcessed(webhookId, "subscription.active");
  console.log(`[Polar] ✅ Activated ${plan} for org ${truncateId(org.id)}`);
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
export async function handleSubscriptionUpdated(payload: PolarWebhookPayload) {
  const webhookId = payload.data.id;

  // Idempotency check
  if (await isWebhookProcessed(webhookId, "subscription.updated")) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookId)} already processed, skipping`
    );
    return;
  }

  const productId = getProductIdFromPayload(payload);
  const customerId = getCustomerIdFromPayload(payload);
  const subscriptionDates = getSubscriptionDatesFromPayload(payload);

  // Try to find organization by subscription ID first
  let org = await db.query.organization.findFirst({
    where: eq(organization.subscriptionId, webhookId),
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
      `[Polar] subscription.updated: No org found for subscription ${truncateId(webhookId)}`
    );
    return;
  }

  const status = payload.data.status as
    | "active"
    | "canceled"
    | "past_due"
    | "none"
    | undefined;
  const newPlan = getPlanFromProductId(productId);
  const oldPlan = org.subscriptionPlan;

  // Log plan change for monitoring
  if (oldPlan && oldPlan !== newPlan) {
    console.log(
      `[Polar] Plan change detected: ${oldPlan} → ${newPlan} for org ${truncateId(org.id)}`
    );
  }

  // Update subscription with new plan and dates
  await subscriptionService.updateSubscription(org.id, {
    subscriptionPlan: newPlan,
    subscriptionStatus: status,
    subscriptionId: webhookId,
    polarCustomerId: customerId,
    // Update billing period dates if provided (important for plan changes)
    subscriptionStartedAt: subscriptionDates.startsAt,
    subscriptionEndsAt: subscriptionDates.endsAt,
  });

  await markWebhookProcessed(webhookId, "subscription.updated");
  console.log(
    `[Polar] ✅ Updated ${newPlan}/${status} for org ${truncateId(org.id)}`
  );
}

/**
 * Handle subscription cancellation
 * Subscription remains active until end of billing period
 */
export async function handleSubscriptionCanceled(payload: PolarWebhookPayload) {
  const webhookId = payload.data.id;

  // Idempotency check
  if (await isWebhookProcessed(webhookId, "subscription.canceled")) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookId)} already processed, skipping`
    );
    return;
  }

  const org = await db.query.organization.findFirst({
    where: eq(organization.subscriptionId, webhookId),
  });

  if (!org) return;

  await subscriptionService.updateSubscription(org.id, {
    subscriptionStatus: "canceled",
  });

  await markWebhookProcessed(webhookId, "subscription.canceled");
  console.log(`[Polar] ✅ Canceled subscription for org ${truncateId(org.id)}`);
}

/**
 * Handle subscription revocation
 * CRITICAL: Unlike cancellation, revocation means IMMEDIATE access termination
 * This happens when payment fails permanently, fraud is detected, or admin action
 */
export async function handleSubscriptionRevoked(payload: PolarWebhookPayload) {
  const webhookId = payload.data.id;

  // Idempotency check
  if (await isWebhookProcessed(webhookId, "subscription.revoked")) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookId)} already processed, skipping`
    );
    return;
  }

  const org = await db.query.organization.findFirst({
    where: eq(organization.subscriptionId, webhookId),
  });

  if (!org) {
    console.log(
      `[Polar] subscription.revoked: No org found for subscription ${truncateId(webhookId)}`
    );
    return;
  }

  // CRITICAL: Immediately revoke access by setting status to 'none'
  await subscriptionService.updateSubscription(org.id, {
    subscriptionStatus: "none",
    subscriptionPlan: null as unknown as SubscriptionPlan, // Clear plan on revocation
  });

  await markWebhookProcessed(webhookId, "subscription.revoked");
  console.log(
    `[Polar] ⚠️ REVOKED subscription for org ${truncateId(org.id)} - access terminated immediately`
  );
}

/**
 * Handle order paid events
 * Can be used for one-time payments or subscription renewals
 */
export async function handleOrderPaid(payload: PolarWebhookPayload) {
  const webhookId = payload.data.id;

  // Idempotency check
  if (await isWebhookProcessed(webhookId, "order.paid")) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookId)} already processed, skipping`
    );
    return;
  }

  const customerId = getCustomerIdFromPayload(payload);
  const productId = getProductIdFromPayload(payload);
  const orgId = getOrganizationIdFromPayload(payload);
  const userId = getUserIdFromPayload(payload);

  let org = orgId ? await findOrganizationById(orgId) : null;

  // Fallback to customerId lookup
  if (!org && customerId) {
    org = await findOrganizationByCustomerId(customerId);
  }

  // Fallback: find by user ID from customer metadata
  if (!org && userId) {
    org = await findOrganizationByUserId(userId);
    // If found via userId, also link the polarCustomerId for future lookups
    if (org && customerId && !org.polarCustomerId) {
      console.log(
        `[Polar] Linking customer ${truncateId(customerId)} to org ${truncateId(org.id)}`
      );
      await db
        .update(organization)
        .set({ polarCustomerId: customerId })
        .where(eq(organization.id, org.id));
    }
  }

  if (!org) {
    console.error(
      `[Polar] Org not found for order (orgRef: ${truncateId(orgId)}, customer: ${truncateId(customerId)}, user: ${truncateId(userId)})`
    );
    return;
  }

  // If this is a subscription product, activate the subscription
  if (productId) {
    const plan = getPlanFromProductId(productId);
    await subscriptionService.updateSubscription(org.id, {
      subscriptionPlan: plan,
      subscriptionStatus: "active",
      polarCustomerId: customerId,
    });
    await markWebhookProcessed(webhookId, "order.paid");
    console.log(
      `[Polar] ✅ Order activated ${plan} for org ${truncateId(org.id)}`
    );
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
  const externalId = (payload.data as any).externalId; // eslint-disable-line @typescript-eslint/no-explicit-any
  const metadataUserId = (payload.data as any).metadata?.userId; // eslint-disable-line @typescript-eslint/no-explicit-any
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
  if (!org.polarCustomerId) {
    await db
      .update(organization)
      .set({ polarCustomerId: customerId })
      .where(eq(organization.id, org.id));
    console.log(
      `[Polar] ✅ customer.created: Linked customer ${truncateId(customerId)} to org ${truncateId(org.id)}`
    );
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
export async function handleCustomerDeleted(payload: PolarWebhookPayload) {
  const customerId = payload.data.id;

  if (!customerId) {
    console.error("[Polar] customer.deleted webhook missing customer ID");
    return;
  }

  console.log(
    `[Polar] customer.deleted: Processing deletion for customer ${truncateId(customerId)}`
  );

  // Find organization by Polar customer ID
  const org = await db.query.organization.findFirst({
    where: eq(organization.polarCustomerId, customerId),
  });

  if (!org) {
    console.log(
      `[Polar] customer.deleted: No organization found for customer ${truncateId(customerId)}`
    );
    return;
  }

  // CRITICAL: Revoke subscription immediately
  // Set subscription to 'none' status and clear customer ID
  await db
    .update(organization)
    .set({
      subscriptionStatus: "none",
      // Keep polarCustomerId for audit trail, but mark as deleted
      // The validatePolarCustomer check will fail since customer doesn't exist in Polar
    })
    .where(eq(organization.id, org.id));

  console.log(
    `[Polar] ✅ customer.deleted: Revoked subscription for org ${truncateId(org.id)} (customer: ${truncateId(customerId)})`
  );
}
