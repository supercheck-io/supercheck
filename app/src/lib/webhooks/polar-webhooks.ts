/**
 * Polar Webhook Handlers
 * Process incoming webhook events from Polar for subscription management
 */

import { subscriptionService } from "@/lib/services/subscription-service";
import { billingSettingsService } from "@/lib/services/billing-settings.service";
import { db } from "@/utils/db";
import { organization } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { SubscriptionPlan } from "@/db/schema";

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
 */
function getPlanFromProductId(productId: string): SubscriptionPlan {
  const plusProductId = process.env.POLAR_PLUS_PRODUCT_ID;
  const proProductId = process.env.POLAR_PRO_PRODUCT_ID;
  
  if (productId === plusProductId) return "plus";
  if (productId === proProductId) return "pro";
  
  // Default to plus for cloud mode
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
  const customerId = getCustomerIdFromPayload(payload);
  const productId = getProductIdFromPayload(payload);
  const orgId = getOrganizationIdFromPayload(payload);
  
  let org = orgId ? await findOrganizationById(orgId) : null;
  if (!org && customerId) {
    org = await findOrganizationByCustomerId(customerId);
  }

  if (!org) {
    console.error("[Polar] Org not found for subscription", { orgId, customerId });
    return;
  }

  // Idempotency check: Skip if already active with same subscription
  if (org.subscriptionStatus === "active" && 
      org.subscriptionId === payload.data.id && 
      org.polarCustomerId === customerId) {
    console.log(`[Polar] Subscription already active for ${org.name}, skipping`);
    return;
  }

  const plan = getPlanFromProductId(productId);
  await subscriptionService.updateSubscription(org.id, {
    subscriptionPlan: plan,
    subscriptionStatus: "active",
    subscriptionId: payload.data.id,
    polarCustomerId: customerId,
  });

  await subscriptionService.resetUsageCounters(org.id);

  try {
    await billingSettingsService.resetNotificationsForPeriod(org.id);
  } catch {
    // Ignore if billing_settings table doesn't exist
  }

  console.log(`[Polar] ✅ Activated ${plan} for ${org.name}`);
}

/**
 * Handle subscription updates
 * Called when subscription plan changes or status updates
 */
export async function handleSubscriptionUpdated(payload: PolarWebhookPayload) {
  const productId = getProductIdFromPayload(payload);

  const org = await db.query.organization.findFirst({
    where: eq(organization.subscriptionId, payload.data.id),
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
          subscriptionId: payload.data.id,
        });

        console.log(`[Polar] ✅ Updated ${plan}/${status} for ${orgByRef.name}`);
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

  console.log(`[Polar] ✅ Updated ${plan}/${status} for ${org.name}`);
}

/**
 * Handle subscription cancellation
 * Subscription remains active until end of billing period
 */
export async function handleSubscriptionCanceled(payload: PolarWebhookPayload) {
  const org = await db.query.organization.findFirst({
    where: eq(organization.subscriptionId, payload.data.id),
  });

  if (!org) return;

  await subscriptionService.updateSubscription(org.id, {
    subscriptionStatus: "canceled",
  });

  console.log(`[Polar] ✅ Canceled subscription for ${org.name}`);
}

/**
 * Handle order paid events
 * Can be used for one-time payments or subscription renewals
 */
export async function handleOrderPaid(payload: PolarWebhookPayload) {
  const customerId = getCustomerIdFromPayload(payload);
  const productId = getProductIdFromPayload(payload);
  const orgId = getOrganizationIdFromPayload(payload);
  
  let org = orgId ? await findOrganizationById(orgId) : null;

  // Fallback to customerId lookup
  if (!org && customerId) {
    org = await findOrganizationByCustomerId(customerId);
  }

  if (!org) {
    console.error("[Polar] Org not found for order", { orgId, customerId });
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
    console.log(`[Polar] ✅ Order activated ${plan} for ${org.name}`);
  }
}

/**
 * Handle customer state changes
 * Aggregated event for any customer-related changes
 */
export async function handleCustomerStateChanged() {
  // Customer state changes are handled by subscription events
}
