/**
 * Polar Webhook Handlers
 * Process incoming webhook events from Polar for subscription management
 * 
 * Security & Reliability:
 * - Idempotency: Prevents duplicate processing via webhook ID tracking
 * - Logging: Uses truncated IDs to avoid leaking sensitive data
 * - Error handling: Graceful degradation on non-critical failures
 */

import { subscriptionService } from "@/lib/services/subscription-service";
import { billingSettingsService } from "@/lib/services/billing-settings.service";
import { db } from "@/utils/db";
import { organization } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { SubscriptionPlan } from "@/db/schema";

// Idempotency cache to prevent duplicate webhook processing
// TTL of 24 hours to handle delayed retries while preventing memory leaks
const WEBHOOK_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const processedWebhooks = new Map<string, number>();

/**
 * Check if a webhook has already been processed (idempotency)
 * Returns true if already processed, false if new
 */
function isWebhookProcessed(webhookId: string, eventType: string): boolean {
  const cacheKey = `${eventType}:${webhookId}`;
  const processedAt = processedWebhooks.get(cacheKey);
  
  if (processedAt && Date.now() - processedAt < WEBHOOK_CACHE_TTL_MS) {
    return true;
  }
  
  return false;
}

/**
 * Mark a webhook as processed
 */
function markWebhookProcessed(webhookId: string, eventType: string): void {
  const cacheKey = `${eventType}:${webhookId}`;
  processedWebhooks.set(cacheKey, Date.now());
  
  // Clean up old entries periodically to prevent memory leaks
  if (processedWebhooks.size > 1000) {
    const now = Date.now();
    for (const [key, timestamp] of processedWebhooks.entries()) {
      if (now - timestamp > WEBHOOK_CACHE_TTL_MS) {
        processedWebhooks.delete(key);
      }
    }
  }
}

/**
 * Truncate ID for safe logging (doesn't expose full IDs)
 */
function truncateId(id: string | undefined | null): string {
  if (!id) return 'unknown';
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
    endsAt?: string;
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
  return '';
}

/**
 * Helper to get customer ID from payload (handles different formats)
 */
function getCustomerIdFromPayload(payload: PolarWebhookPayload): string | undefined {
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
  console.warn(`[Polar] Unknown product ID: ${productId}, defaulting to plus plan`);
  return "plus";
}

/**
 * Extract organization ID from webhook payload
 * Checks referenceId in metadata (passed during checkout)
 */
function getOrganizationIdFromPayload(payload: PolarWebhookPayload): string | null {
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
    console.log(`[Polar] Found organization ${truncateId(org.id)} via user ${truncateId(userId)}`);
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
  const customer = payload.data.customer as { metadata?: { userId?: string } } | undefined;
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
  if (isWebhookProcessed(webhookId, 'subscription.active')) {
    console.log(`[Polar] Webhook ${truncateId(webhookId)} already processed, skipping`);
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
      console.log(`[Polar] Linking customer ${truncateId(customerId)} to org ${truncateId(org.id)}`);
      await db
        .update(organization)
        .set({ polarCustomerId: customerId })
        .where(eq(organization.id, org.id));
    }
  }

  if (!org) {
    console.error(`[Polar] Org not found for subscription (orgRef: ${truncateId(orgId)}, customer: ${truncateId(customerId)}, user: ${truncateId(userId)})`);
    return;
  }

  // Additional idempotency: Skip if already active with same subscription
  if (org.subscriptionStatus === "active" && 
      org.subscriptionId === webhookId && 
      org.polarCustomerId === customerId) {
    console.log(`[Polar] Subscription already active for ${truncateId(org.id)}, skipping`);
    markWebhookProcessed(webhookId, 'subscription.active');
    return;
  }

  const plan = getPlanFromProductId(productId);
  await subscriptionService.updateSubscription(org.id, {
    subscriptionPlan: plan,
    subscriptionStatus: "active",
    subscriptionId: webhookId,
    polarCustomerId: customerId,
  });

  await subscriptionService.resetUsageCounters(org.id);

  try {
    await billingSettingsService.resetNotificationsForPeriod(org.id);
  } catch {
    // Ignore if billing_settings table doesn't exist
  }

  // Mark webhook as processed after successful handling
  markWebhookProcessed(webhookId, 'subscription.active');
  console.log(`[Polar] ✅ Activated ${plan} for org ${truncateId(org.id)}`);
}

/**
 * Handle subscription updates
 * Called when subscription plan changes or status updates
 */
export async function handleSubscriptionUpdated(payload: PolarWebhookPayload) {
  const webhookId = payload.data.id;
  
  // Idempotency check
  if (isWebhookProcessed(webhookId, 'subscription.updated')) {
    console.log(`[Polar] Webhook ${truncateId(webhookId)} already processed, skipping`);
    return;
  }

  const productId = getProductIdFromPayload(payload);

  const org = await db.query.organization.findFirst({
    where: eq(organization.subscriptionId, webhookId),
  });

  if (!org) {
    // Try to find by referenceId in metadata
    const orgId = getOrganizationIdFromPayload(payload);
    if (orgId) {
      const orgByRef = await findOrganizationById(orgId);
      if (orgByRef) {
        const status = payload.data.status as "active" | "canceled" | "past_due" | "none" | undefined;
        const plan = getPlanFromProductId(productId);

        await subscriptionService.updateSubscription(orgByRef.id, {
          subscriptionPlan: plan,
          subscriptionStatus: status,
          subscriptionId: webhookId,
        });

        markWebhookProcessed(webhookId, 'subscription.updated');
        console.log(`[Polar] ✅ Updated ${plan}/${status} for org ${truncateId(orgByRef.id)}`);
        return;
      }
    }
    return;
  }

  const status = payload.data.status as "active" | "canceled" | "past_due" | "none" | undefined;
  const plan = getPlanFromProductId(productId);

  await subscriptionService.updateSubscription(org.id, {
    subscriptionPlan: plan,
    subscriptionStatus: status,
  });

  markWebhookProcessed(webhookId, 'subscription.updated');
  console.log(`[Polar] ✅ Updated ${plan}/${status} for org ${truncateId(org.id)}`);
}

/**
 * Handle subscription cancellation
 * Subscription remains active until end of billing period
 */
export async function handleSubscriptionCanceled(payload: PolarWebhookPayload) {
  const webhookId = payload.data.id;
  
  // Idempotency check
  if (isWebhookProcessed(webhookId, 'subscription.canceled')) {
    console.log(`[Polar] Webhook ${truncateId(webhookId)} already processed, skipping`);
    return;
  }

  const org = await db.query.organization.findFirst({
    where: eq(organization.subscriptionId, webhookId),
  });

  if (!org) return;

  await subscriptionService.updateSubscription(org.id, {
    subscriptionStatus: "canceled",
  });

  markWebhookProcessed(webhookId, 'subscription.canceled');
  console.log(`[Polar] ✅ Canceled subscription for org ${truncateId(org.id)}`);
}

/**
 * Handle order paid events
 * Can be used for one-time payments or subscription renewals
 */
export async function handleOrderPaid(payload: PolarWebhookPayload) {
  const webhookId = payload.data.id;
  
  // Idempotency check
  if (isWebhookProcessed(webhookId, 'order.paid')) {
    console.log(`[Polar] Webhook ${truncateId(webhookId)} already processed, skipping`);
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
      console.log(`[Polar] Linking customer ${truncateId(customerId)} to org ${truncateId(org.id)}`);
      await db
        .update(organization)
        .set({ polarCustomerId: customerId })
        .where(eq(organization.id, org.id));
    }
  }

  if (!org) {
    console.error(`[Polar] Org not found for order (orgRef: ${truncateId(orgId)}, customer: ${truncateId(customerId)}, user: ${truncateId(userId)})`);
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
    markWebhookProcessed(webhookId, 'order.paid');
    console.log(`[Polar] ✅ Order activated ${plan} for org ${truncateId(org.id)}`);
  }
}

/**
 * Handle customer state changes
 * Aggregated event for any customer-related changes
 */
export async function handleCustomerStateChanged() {
  // Customer state changes are handled by subscription events
}
