/**
 * Feature flags and configuration for conditional features
 * Handles self-hosted vs cloud-hosted modes
 *
 * DEFAULT BEHAVIOR:
 * - When SELF_HOSTED is not set or is any value other than "true"/"1" -> Cloud mode (billing enabled)
 * - When SELF_HOSTED="true" or SELF_HOSTED="1" -> Self-hosted mode (unlimited, no billing)
 *
 * This ensures cloud deployments work by default without extra configuration.
 */

/**
 * Check if the application is running in cloud-hosted mode
 *
 * Cloud mode is the DEFAULT when:
 * - SELF_HOSTED env var is not set
 * - SELF_HOSTED is set to "false", "0", or any other value
 *
 * Self-hosted mode ONLY when:
 * - SELF_HOSTED="true" (case insensitive)
 * - SELF_HOSTED="1"
 *
 * Self-hosted installations have unlimited features without billing.
 * Cloud installations require a subscription (Plus or Pro plan).
 */
export const isCloudHosted = (): boolean => {
  const selfHosted = process.env.SELF_HOSTED?.toLowerCase();
  // Cloud mode is default - only self-hosted when explicitly set to "true" or "1"
  return selfHosted !== "true" && selfHosted !== "1";
};

/**
 * Check if the application is running in self-hosted mode.
 * Self-hosted is enabled only when SELF_HOSTED is explicitly set to "true" or "1".
 */
export const isSelfHosted = (): boolean => {
  return !isCloudHosted();
};

/**
 * Check if Polar payment integration is enabled
 * Requires cloud-hosted mode and proper configuration
 */
export const isPolarEnabled = (): boolean => {
  return isCloudHosted() && !!process.env.POLAR_ACCESS_TOKEN;
};

/**
 * Validate Polar configuration for production
 * Throws error if required configuration is missing in cloud mode
 */
export const validatePolarConfig = (): void => {
  if (!isCloudHosted()) {
    return; // Self-hosted mode doesn't need Polar config
  }

  const requiredVars = [
    "POLAR_ACCESS_TOKEN",
    "POLAR_WEBHOOK_SECRET",
    "POLAR_PLUS_PRODUCT_ID",
    "POLAR_PRO_PRODUCT_ID",
  ];

  const missing = requiredVars.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required Polar environment variables: ${missing.join(", ")}. ` +
        `These are required for cloud-hosted mode. ` +
        `Please check your environment configuration.`
    );
  }

  // Validate server value
  const server = process.env.POLAR_SERVER || "production";
  if (!["production", "sandbox"].includes(server)) {
    throw new Error(
      `Invalid POLAR_SERVER value: "${server}". Must be "production" or "sandbox".`
    );
  }
};

/**
 * Get Polar configuration if enabled
 * Returns null if Polar is not enabled
 */
export const getPolarConfig = (): {
  accessToken: string;
  server: "production" | "sandbox";
  webhookSecret: string;
} | null => {
  if (!isPolarEnabled()) {
    return null;
  }

  const webhookSecret = process.env.POLAR_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error(
      "POLAR_WEBHOOK_SECRET is required for secure webhook processing in production."
    );
  }

  return {
    accessToken: process.env.POLAR_ACCESS_TOKEN!,
    server: (process.env.POLAR_SERVER || "production") as
      | "production"
      | "sandbox",
    webhookSecret,
  };
};

/**
 * Get Polar product IDs for checkout
 * Returns null if not configured
 */
export const getPolarProducts = (): {
  plusProductId: string;
  proProductId: string;
} | null => {
  if (!isPolarEnabled()) {
    return null;
  }

  const plusProductId = process.env.POLAR_PLUS_PRODUCT_ID;
  const proProductId = process.env.POLAR_PRO_PRODUCT_ID;

  if (!plusProductId || !proProductId) {
    console.warn("[Polar] Product IDs not configured. Checkout will not work.");
    return null;
  }

  return {
    plusProductId,
    proProductId,
  };
};

/**
 * Plan base pricing in cents
 * These are the monthly subscription fees (before overage)
 * Must match what's configured in Polar dashboard
 */
export const PLAN_PRICING = {
  plus: {
    monthlyPriceCents: 4900, // $49/month
    name: "Plus",
  },
  pro: {
    monthlyPriceCents: 14900, // $149/month
    name: "Pro",
  },
  unlimited: {
    monthlyPriceCents: 0, // Free (self-hosted)
    name: "Unlimited",
  },
} as const;

/**
 * Get plan pricing for a specific plan
 */
export const getPlanPricing = (plan: "plus" | "pro" | "unlimited") => {
  return PLAN_PRICING[plan] || PLAN_PRICING.plus;
};

/**
 * Check if CAPTCHA verification is enabled
 *
 * CAPTCHA (Cloudflare Turnstile) is automatically enabled when
 * both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are set.
 *
 * This provides bot protection on authentication endpoints:
 * - /sign-in/email
 * - /sign-up/email
 * - /forget-password
 */
export const isCaptchaEnabled = (): boolean => {
  return !!process.env.TURNSTILE_SECRET_KEY && !!process.env.TURNSTILE_SITE_KEY;
};

/**
 * Get Turnstile site key for client-side widget
 * Returns null if CAPTCHA is not configured
 */
export const getTurnstileSiteKey = (): string | null => {
  if (!isCaptchaEnabled()) return null;
  return process.env.TURNSTILE_SITE_KEY || null;
};
