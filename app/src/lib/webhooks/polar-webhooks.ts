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
import { db } from "@/utils/db";
import { organization, webhookIdempotency } from "@/db/schema";
import { eq, and, lt, isNull } from "drizzle-orm";
import type { SubscriptionPlan } from "@/db/schema";

// Idempotency TTL: 24 hours
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
    const expiresAt = new Date(Date.now() + WEBHOOK_IDEMPOTENCY_TTL_MS);

    // Atomic insert - will fail if unique constraint violated
    // This is the key to preventing race conditions in multi-instance deployments
    const result = await db
      .insert(webhookIdempotency)
      .values({
        webhookId,
        eventType,
        resultStatus: "success",
        expiresAt,
      })
      .onConflictDoNothing({
        target: [webhookIdempotency.webhookId, webhookIdempotency.eventType],
      })
      .returning();

    // If no row returned, the webhook was already claimed/processed
    return result.length > 0;
  } catch (error) {
    // If table doesn't exist yet (pre-migration), fall back to allowing processing
    // This prevents blocking webhooks during migration period
    console.warn(
      `[Polar] Idempotency claim failed (table may not exist yet): ${error}`
    );
    return true; // Allow processing to avoid blocking webhooks
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
    await db
      .update(webhookIdempotency)
      .set({
        resultStatus: status,
        resultMessage: message,
      })
      .where(
        and(
          eq(webhookIdempotency.webhookId, webhookId),
          eq(webhookIdempotency.eventType, eventType)
        )
      );
  } catch (error) {
    // Log but don't fail - updating status is non-critical
    console.warn(`[Polar] Failed to update webhook result: ${error}`);
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
  const subscription = (payload.data as any).subscription;  
  if (subscription?.metadata?.referenceId) {
    return subscription.metadata.referenceId;
  }
  // Check product metadata
  const product = (payload.data as any).product;  
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

  // Atomic idempotency: Try to claim this webhook for processing
  // If another instance already claimed it, skip processing
  if (!(await tryClaimWebhook(webhookId, "subscription.active"))) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookId)} already claimed/processed, skipping`
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
    // SECURITY: Use conditional update to prevent race condition
    if (org && customerId && !org.polarCustomerId) {
      console.log(
        `[Polar] Linking customer ${truncateId(customerId)} to org ${truncateId(org.id)}`
      );
      await db
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
      webhookId,
      "subscription.active",
      "error",
      "Organization not found"
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
    await updateWebhookResult(
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

  // Atomic idempotency: Try to claim this webhook for processing
  if (!(await tryClaimWebhook(webhookId, "subscription.updated"))) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookId)} already claimed/processed, skipping`
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
    await updateWebhookResult(
      webhookId,
      "subscription.updated",
      "error",
      "Organization not found"
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

  console.log(
    `[Polar] ✅ Updated ${newPlan}/${status} for org ${truncateId(org.id)}`
  );
}

/**
 * Handle subscription cancellation
 * Subscription remains active until end of billing period
 * IMPORTANT: User should retain access until subscriptionEndsAt date
 */
export async function handleSubscriptionCanceled(payload: PolarWebhookPayload) {
  const webhookId = payload.data.id;

  // Atomic idempotency: Try to claim this webhook for processing
  if (!(await tryClaimWebhook(webhookId, "subscription.canceled"))) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookId)} already claimed/processed, skipping`
    );
    return;
  }

  const org = await db.query.organization.findFirst({
    where: eq(organization.subscriptionId, webhookId),
  });

  if (!org) {
    await updateWebhookResult(
      webhookId,
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
    subscriptionEndsAt: subscriptionDates.endsAt,
  });

  console.log(
    `[Polar] ✅ Canceled subscription for org ${truncateId(org.id)} (access until ${subscriptionDates.endsAt?.toISOString() || "period end"})`
  );
}

/**
 * Handle subscription revocation
 * CRITICAL: Unlike cancellation, revocation means IMMEDIATE access termination
 * This happens when payment fails permanently, fraud is detected, or admin action
 */
export async function handleSubscriptionRevoked(payload: PolarWebhookPayload) {
  const webhookId = payload.data.id;

  // Atomic idempotency: Try to claim this webhook for processing
  if (!(await tryClaimWebhook(webhookId, "subscription.revoked"))) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookId)} already claimed/processed, skipping`
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
    await updateWebhookResult(
      webhookId,
      "subscription.revoked",
      "error",
      "Organization not found"
    );
    return;
  }

  // CRITICAL: Immediately revoke access by setting status to 'none'
  await subscriptionService.updateSubscription(org.id, {
    subscriptionStatus: "none",
    subscriptionPlan: null as unknown as SubscriptionPlan, // Clear plan on revocation
  });

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

  // Atomic idempotency: Try to claim this webhook for processing
  if (!(await tryClaimWebhook(webhookId, "order.paid"))) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookId)} already claimed/processed, skipping`
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
    // SECURITY: Use conditional update to prevent race condition
    if (org && customerId && !org.polarCustomerId) {
      console.log(
        `[Polar] Linking customer ${truncateId(customerId)} to org ${truncateId(org.id)}`
      );
      await db
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
      webhookId,
      "order.paid",
      "error",
      "Organization not found"
    );
    return;
  }

  // If this is a subscription product, activate the subscription
  if (productId) {
    const plan = getPlanFromProductId(productId);

    // Get subscription ID from order's subscription reference if available
    const subscriptionId =
      (payload.data as any).subscription?.id ||  
      (payload.data as any).subscriptionId ||  
      webhookId; // Fallback to order ID

    await subscriptionService.updateSubscription(org.id, {
      subscriptionPlan: plan,
      subscriptionStatus: "active",
      subscriptionId: subscriptionId, // Now properly sets subscription ID
      polarCustomerId: customerId,
    });
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
  const externalId = (payload.data as any).externalId;  
  const metadataUserId = (payload.data as any).metadata?.userId;  
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
    const result = await db
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
export async function handleSubscriptionUncanceled(
  payload: PolarWebhookPayload
) {
  const webhookId = payload.data.id;

  // Atomic idempotency: Try to claim this webhook for processing
  if (!(await tryClaimWebhook(webhookId, "subscription.uncanceled"))) {
    console.log(
      `[Polar] Webhook ${truncateId(webhookId)} already claimed/processed, skipping`
    );
    return;
  }

  const customerId = getCustomerIdFromPayload(payload);
  const productId = getProductIdFromPayload(payload);
  const orgId = getOrganizationIdFromPayload(payload);

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
      webhookId,
      "subscription.uncanceled",
      "error",
      "Organization not found"
    );
    return;
  }

  const plan = getPlanFromProductId(productId);
  const subscriptionDates = getSubscriptionDatesFromPayload(payload);

  // Restore subscription to active status
  // The subscription was canceled but now it's back to active
  await subscriptionService.updateSubscription(org.id, {
    subscriptionPlan: plan,
    subscriptionStatus: "active",
    subscriptionId: webhookId,
    polarCustomerId: customerId,
    // Update dates from payload
    subscriptionStartedAt: subscriptionDates.startsAt,
    subscriptionEndsAt: subscriptionDates.endsAt,
  });

  console.log(
    `[Polar] ✅ UNCANCELED subscription restored for org ${truncateId(org.id)} - ${plan} plan`
  );

  await updateWebhookResult(
    webhookId,
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
