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
 * Validate Polar configuration for production
 * Throws error if required configuration is missing in cloud mode
 */
export const validatePolarConfig = (): void => {
  if (!isCloudHosted()) {
    return; // Self-hosted mode doesn't need Polar config
  }

  const requiredVars = [
    'POLAR_ACCESS_TOKEN',
    'POLAR_WEBHOOK_SECRET',
    'POLAR_PLUS_PRODUCT_ID',
    'POLAR_PRO_PRODUCT_ID'
  ];

  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required Polar environment variables: ${missing.join(', ')}. ` +
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
export const getPolarConfig = ():
  | {
      accessToken: string;
      server: "production" | "sandbox";
      webhookSecret: string;
    }
  | null => {
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
