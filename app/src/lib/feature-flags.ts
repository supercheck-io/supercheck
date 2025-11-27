/**
 * Feature flags and configuration for conditional features
 * Handles self-hosted vs cloud-hosted modes
 */

/**
 * Check if the application is running in cloud-hosted mode
 * Self-hosted installations have unlimited features without billing
 */
export const isCloudHosted = (): boolean => {
  const selfHosted = process.env.SELF_HOSTED?.toLowerCase();
  return selfHosted !== "true" && selfHosted !== "1";
};

/**
 * Check if Polar payment integration is enabled
 * Requires cloud-hosted mode and proper configuration
 */
export const isPolarEnabled = (): boolean => {
  return isCloudHosted() && !!process.env.POLAR_ACCESS_TOKEN;
};

/**
 * Get Polar configuration if enabled
 * Returns null if Polar is not enabled
 */
export const getPolarConfig = ():
  | {
      accessToken: string;
      server: "production" | "sandbox";
      webhookSecret: string | undefined;
    }
  | null => {
  if (!isPolarEnabled()) {
    return null;
  }

  return {
    accessToken: process.env.POLAR_ACCESS_TOKEN!,
    server: (process.env.POLAR_SERVER || "production") as
      | "production"
      | "sandbox",
    webhookSecret: process.env.POLAR_WEBHOOK_SECRET,
  };
};

/**
 * Get Polar product IDs for checkout
 * Returns null if not configured
 */
export const getPolarProducts = ():
  | {
      plusProductId: string;
      proProductId: string;
    }
  | null => {
  if (!isPolarEnabled()) {
    return null;
  }

  const plusProductId = process.env.POLAR_PLUS_PRODUCT_ID;
  const proProductId = process.env.POLAR_PRO_PRODUCT_ID;

  if (!plusProductId || !proProductId) {
    console.warn(
      "[Polar] Product IDs not configured. Checkout will not work."
    );
    return null;
  }

  return {
    plusProductId,
    proProductId,
  };
};
