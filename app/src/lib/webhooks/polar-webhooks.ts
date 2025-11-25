/**
 * Polar Webhook Handlers
 * Process incoming webhook events from Polar for subscription management
 */

import { subscriptionService } from "@/lib/services/subscription-service";
import { db } from "@/utils/db";
import { organization } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { SubscriptionPlan } from "@/db/schema";

// Polar webhook payload types
interface PolarWebhookPayload {
  type?: string;
  data: {
    id: string;
    customer_id?: string;
    product_id?: string;
    status?: string;
    ends_at?: string;
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
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Map Polar product ID to subscription plan
 */
function getPlanFromProductId(productId: string): SubscriptionPlan {
  const plusProductId = process.env.POLAR_PLUS_PRODUCT_ID;
  const proProductId = process.env.POLAR_PRO_PRODUCT_ID;
  
  console.log('[Polar] Mapping product ID:', {
    productId,
    plusProductId,
    proProductId,
    isPlus: productId === plusProductId,
    isPro: productId === proProductId,
  });
  
  if (productId === plusProductId) {
    return "plus";
  } else if (productId === proProductId) {
    return "pro";
  }
  
  console.warn(`[Polar] Unknown product ID: ${productId}, defaulting to plus (fallback)`);
  // Default to plus instead of unlimited for cloud mode
  return "plus";
}

/**
 * Extract organization ID from webhook payload
 * Checks referenceId in metadata (passed during checkout)
 */
function getOrganizationIdFromPayload(payload: PolarWebhookPayload): string | null {
  // Check direct metadata (subscription events)
  if (payload.data.metadata?.referenceId) {
    console.log('[Polar] Found referenceId in data.metadata:', payload.data.metadata.referenceId);
    return payload.data.metadata.referenceId;
  }
  // Check checkout metadata
  if (payload.data.checkout?.metadata?.referenceId) {
    console.log('[Polar] Found referenceId in checkout.metadata:', payload.data.checkout.metadata.referenceId);
    return payload.data.checkout.metadata.referenceId;
  }
  // Check subscription metadata (for order events)
  const subscription = (payload.data as any).subscription; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (subscription?.metadata?.referenceId) {
    console.log('[Polar] Found referenceId in subscription.metadata:', subscription.metadata.referenceId);
    return subscription.metadata.referenceId;
  }
  console.log('[Polar] No referenceId found in payload');
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
    console.error(
      `[Polar] Organization not found for customer: ${customerId}`
    );
  }

  return org;
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
  console.log("[Polar Webhook] Subscription activated:", {
    subscriptionId: payload.data.id,
    customerId: payload.data.customer_id,
    productId: payload.data.product_id,
    metadata: payload.data.metadata,
    checkoutMetadata: payload.data.checkout?.metadata,
  });

  // Try to find organization by referenceId first (passed during checkout)
  const orgId = getOrganizationIdFromPayload(payload);
  let org = orgId ? await findOrganizationById(orgId) : null;

  // Fallback to customer_id lookup
  if (!org && payload.data.customer_id) {
    org = await findOrganizationByCustomerId(payload.data.customer_id);
  }

  if (!org) {
    console.error("[Polar] Could not find organization for subscription:", {
      referenceId: orgId,
      customerId: payload.data.customer_id,
    });
    return;
  }

  // Determine plan from product ID
  const plan = getPlanFromProductId(payload.data.product_id || "");

  // Update organization with subscription details and customer ID
  await subscriptionService.updateSubscription(org.id, {
    subscriptionPlan: plan,
    subscriptionStatus: "active",
    subscriptionId: payload.data.id,
    polarCustomerId: payload.data.customer_id, // Store customer ID for future lookups
  });

  // Reset usage counters for new billing period
  await subscriptionService.resetUsageCounters(org.id);

  console.log(
    `[Polar] Activated ${plan} plan for organization ${org.name} (${org.id})`
  );
}

/**
 * Handle subscription updates
 * Called when subscription plan changes or status updates
 */
export async function handleSubscriptionUpdated(payload: PolarWebhookPayload) {
  console.log("[Polar Webhook] Subscription updated:", {
    subscriptionId: payload.data.id,
    status: payload.data.status,
    productId: payload.data.product_id,
  });

  const org = await db.query.organization.findFirst({
    where: eq(organization.subscriptionId, payload.data.id),
  });

  if (!org) {
    console.error(
      `[Polar] Organization not found for subscription: ${payload.data.id}`
    );
    return;
  }

  const status = payload.data.status as "active" | "canceled" | "past_due" | "none" | undefined;
  const productId = payload.data.product_id;
  const plan = getPlanFromProductId(productId || "");

  await subscriptionService.updateSubscription(org.id, {
    subscriptionPlan: plan,
    subscriptionStatus: status,
  });

  console.log(
    `[Polar] Updated subscription for organization ${org.name}: ${plan} / ${status}`
  );
}

/**
 * Handle subscription cancellation
 * Subscription remains active until end of billing period
 */
export async function handleSubscriptionCanceled(payload: PolarWebhookPayload) {
  console.log("[Polar Webhook] Subscription canceled:", {
    subscriptionId: payload.data.id,
    endsAt: payload.data.ends_at,
  });

  const org = await db.query.organization.findFirst({
    where: eq(organization.subscriptionId, payload.data.id),
  });

  if (!org) {
    console.error(
      `[Polar] Organization not found for subscription: ${payload.data.id}`
    );
    return;
  }

  await subscriptionService.updateSubscription(org.id, {
    subscriptionStatus: "canceled",
    // Keep plan active until end of billing period
  });

  console.log(
    `[Polar] Canceled subscription for organization ${org.name}, access continues until ${payload.data.ends_at}`
  );
}

/**
 * Handle order paid events
 * Can be used for one-time payments or subscription renewals
 */
export async function handleOrderPaid(payload: PolarWebhookPayload) {
  console.log("[Polar Webhook] Order paid:", {
    orderId: payload.data.id,
    customerId: payload.data.customer_id,
    productId: payload.data.product_id,
    amount: payload.data.amount,
    currency: payload.data.currency,
    metadata: payload.data.metadata,
    checkoutMetadata: payload.data.checkout?.metadata,
  });

  // Try to find organization by referenceId first
  const orgId = getOrganizationIdFromPayload(payload);
  let org = orgId ? await findOrganizationById(orgId) : null;

  // Fallback to customer_id lookup
  if (!org && payload.data.customer_id) {
    org = await findOrganizationByCustomerId(payload.data.customer_id);
  }

  if (!org) {
    console.error("[Polar] Could not find organization for order:", {
      referenceId: orgId,
      customerId: payload.data.customer_id,
    });
    return;
  }

  // If this is a subscription product, activate the subscription
  const productId = payload.data.product_id;
  if (productId) {
    const plan = getPlanFromProductId(productId);
    
    await subscriptionService.updateSubscription(org.id, {
      subscriptionPlan: plan,
      subscriptionStatus: "active",
      polarCustomerId: payload.data.customer_id,
    });

    console.log(
      `[Polar] Order paid - activated ${plan} plan for organization ${org.name}`
    );
  } else {
    console.log(
      `[Polar] Order paid for organization ${org.name}: ${payload.data.currency} ${payload.data.amount}`
    );
  }
}

/**
 * Handle customer state changes
 * Aggregated event for any customer-related changes
 */
export async function handleCustomerStateChanged(payload: PolarWebhookPayload) {
  console.log("[Polar Webhook] Customer state changed:", {
    customerId: payload.data.customer_id,
  });

  // This is a catch-all event, specific handlers above are preferred
  // Can be used for additional logging or monitoring
}
