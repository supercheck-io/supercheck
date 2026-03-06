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

const isExplicitlyEnabled = (value?: string): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
};

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
  // Cloud mode is default - only self-hosted when explicitly set to "true" or "1"
  return !isExplicitlyEnabled(process.env.SELF_HOSTED);
};

/**
 * Check if the application is running in self-hosted mode.
 * Self-hosted is enabled only when SELF_HOSTED is explicitly set to "true" or "1".
 */
export const isSelfHosted = (): boolean => {
  return !isCloudHosted();
};

/**
 * Check whether public status page branding should be hidden globally.
 *
 * Controlled by the `STATUS_PAGE_HIDE_BRANDING` environment variable:
 * - Not set, empty, or any value other than "true"/"1" -> branding is shown (default)
 * - "true" or "1" (case-insensitive)                    -> branding is hidden
 *
 * This is a deployment-wide setting and intentionally not configurable per status page.
 */
export const isStatusPageBrandingHidden = (): boolean => {
  return isExplicitlyEnabled(process.env.STATUS_PAGE_HIDE_BRANDING);
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
 * CAPTCHA (Cloudflare Turnstile) is enabled ONLY in cloud mode when
 * both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are set.
 *
 * Self-hosted instances NEVER have CAPTCHA enabled, regardless of
 * whether Turnstile keys are configured. This is intentional:
 * self-hosted operators control their own infrastructure and don't
 * need bot protection gates on auth endpoints.
 *
 * Protected endpoints (cloud mode only):
 * - /sign-in/email
 * - /sign-up/email
 * - /forget-password
 */
export const isCaptchaEnabled = (): boolean => {
  // CAPTCHA is explicitly disabled for self-hosted deployments
  if (isSelfHosted()) return false;
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

/**
 * Check if new user signup/registration is enabled.
 *
 * Controlled by the `SIGNUP_ENABLED` environment variable:
 * - Not set or any value other than "false"/"0" → signup is ENABLED (default)
 * - "false" or "0" (case-insensitive)           → signup is DISABLED
 *
 * When disabled:
 * - The sign-up page shows a "Registration closed" message
 * - The POST /api/auth/sign-up/email endpoint returns 403
 * - Existing invitation-based sign-up still works (invited users can register)
 * - OAuth sign-in for existing users still works
 *
 * This is useful for self-hosted deployments where the admin wants to create
 * the initial account and then lock down registration.
 */
export const isSignupEnabled = (): boolean => {
  const value = process.env.SIGNUP_ENABLED?.toLowerCase();
  // Enabled by default — only disabled when explicitly set to "false" or "0"
  return value !== "false" && value !== "0";
};

/**
 * Get allowed email domains for registration.
 *
 * Controlled by the `ALLOWED_EMAIL_DOMAINS` environment variable:
 * - Not set or empty → all email domains are allowed (no restriction)
 * - Comma-separated list of domains → only emails from these domains can register
 *
 * Example:
 *   ALLOWED_EMAIL_DOMAINS=acme.com,acme.org
 *   → Only user@acme.com and user@acme.org can sign up
 *
 * This restriction applies to:
 * - Self-hosted open registration
 * - Invitation-based sign-up (invited emails must also match)
 *
 * Domain matching is case-insensitive.
 */
export const getAllowedEmailDomains = (): string[] => {
  const value = process.env.ALLOWED_EMAIL_DOMAINS?.trim();
  if (!value) return [];
  return value
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
};

/**
 * Check if an email address is allowed based on ALLOWED_EMAIL_DOMAINS.
 * Returns true if:
 * - No domain restriction is configured (ALLOWED_EMAIL_DOMAINS is empty/unset)
 * - The email's domain is in the allowed list
 */
export const isEmailDomainAllowed = (email: string): boolean => {
  const allowedDomains = getAllowedEmailDomains();
  if (allowedDomains.length === 0) return true; // No restriction
  const emailDomain = email.toLowerCase().split("@")[1];
  if (!emailDomain) return false;
  return allowedDomains.includes(emailDomain);
};
