import type { webhooks } from "@polar-sh/better-auth";
import { createPolarCoreClient } from "@/lib/billing/polar-client";
import { normalizePolarPayload } from "@/lib/webhooks/polar-payload";
import { isPolarEnabled, getPolarConfig } from "@/lib/feature-flags";

type PolarConfig = NonNullable<ReturnType<typeof getPolarConfig>>;
type WebhookHandlers = Omit<Parameters<typeof webhooks>[0], "secret">;

export function buildPolarPlugin(config: PolarConfig, handlers: WebhookHandlers) {
  const { polar, webhooks } = require("@polar-sh/better-auth") as typeof import("@polar-sh/better-auth");
  return polar({
    client: createPolarCoreClient({ accessToken: config.accessToken, server: config.server }),
    // Customer creation runs after signup so upstream errors cannot block signup.
    createCustomerOnSignUp: false,
    use: [webhooks({ ...handlers, secret: config.webhookSecret })],
  });
}

export function getPolarPlugin() {
  if (!isPolarEnabled()) return null;
  try {
    return buildPolarPlugin(getPolarConfig()!, {
      onCustomerCreated: async (payload: any) => {
        console.log("[Polar] Webhook: customer.created");
        const { handleCustomerCreated } = await import(
          "@/lib/webhooks/polar-webhooks"
        );
        await handleCustomerCreated(normalizePolarPayload(payload));
      },

      onSubscriptionActive: async (payload: any) => {
        console.log("[Polar] Webhook: subscription.active");
        const { handleSubscriptionActive } = await import(
          "@/lib/webhooks/polar-webhooks"
        );
        await handleSubscriptionActive(normalizePolarPayload(payload));
      },

      onSubscriptionCreated: async (payload: any) => {
        console.log("[Polar] Webhook: subscription.created");
        const { handleSubscriptionCreated } = await import(
          "@/lib/webhooks/polar-webhooks"
        );
        await handleSubscriptionCreated(normalizePolarPayload(payload));
      },

      onSubscriptionUpdated: async (payload: any) => {
        console.log("[Polar] Webhook: subscription.updated");
        const { handleSubscriptionUpdated } = await import(
          "@/lib/webhooks/polar-webhooks"
        );
        await handleSubscriptionUpdated(normalizePolarPayload(payload));
      },

      onSubscriptionCanceled: async (payload: any) => {
        console.log("[Polar] Webhook: subscription.canceled");
        const { handleSubscriptionCanceled } = await import(
          "@/lib/webhooks/polar-webhooks"
        );
        await handleSubscriptionCanceled(normalizePolarPayload(payload));
      },

      onSubscriptionUncanceled: async (payload: any) => {
        console.log("[Polar] Webhook: subscription.uncanceled");
        const { handleSubscriptionUncanceled } = await import(
          "@/lib/webhooks/polar-webhooks"
        );
        await handleSubscriptionUncanceled(normalizePolarPayload(payload));
      },

      onSubscriptionRevoked: async (payload: any) => {
        console.log("[Polar] Webhook: subscription.revoked");
        const { handleSubscriptionRevoked } = await import(
          "@/lib/webhooks/polar-webhooks"
        );
        await handleSubscriptionRevoked(normalizePolarPayload(payload));
      },

      onOrderCreated: async (payload: any) => {
        console.log("[Polar] Webhook: order.created");
        const { handleOrderCreated } = await import(
          "@/lib/webhooks/polar-webhooks"
        );
        await handleOrderCreated(normalizePolarPayload(payload));
      },

      onOrderPaid: async (payload: any) => {
        console.log("[Polar] Webhook: order.paid");
        const { handleOrderPaid } = await import(
          "@/lib/webhooks/polar-webhooks"
        );
        await handleOrderPaid(normalizePolarPayload(payload));
      },
      onCustomerStateChanged: async (payload: any) => {
        console.log("[Polar] Webhook: customer.state_changed");
        const { handleCustomerStateChanged } = await import(
          "@/lib/webhooks/polar-webhooks"
        );
        await handleCustomerStateChanged(normalizePolarPayload(payload));
      },

      onCustomerDeleted: async (payload: any) => {
        console.log("[Polar] Webhook: customer.deleted");
        const { handleCustomerDeleted } = await import(
          "@/lib/webhooks/polar-webhooks"
        );
        await handleCustomerDeleted(normalizePolarPayload(payload));
      },

      onPayload: async (payload: any) => {
        console.log("[Polar] Webhook received:", payload.type);
        if (payload.type === "subscription.past_due") {
          const { handleSubscriptionPastDue } = await import(
            "@/lib/webhooks/polar-webhooks"
          );
          await handleSubscriptionPastDue(normalizePolarPayload(payload));
        }
      },
    });
  } catch (error) {
    console.error("[Better Auth] Failed to initialize Polar plugin:", error);
    // A configured deployment must fail closed without verified webhooks.
    throw error;
  }
}
