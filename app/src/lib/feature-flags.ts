/**
 * Feature flags and configuration for conditional features
 * Handles self-hosted vs cloud-hosted modes
 */

/**
 * Check if the application is running in cloud-hosted mode
 * Self-hosted installations have unlimited features without billing
 * Uses NEXT_PUBLIC_SELF_HOSTED so it works on both server and client
 */
export const isCloudHosted = (): boolean => {
  // Check both prefixed (client/build-time) and non-prefixed (server/runtime) variables
  const selfHosted = process.env.NEXT_PUBLIC_SELF_HOSTED?.toLowerCase() || 
                     process.env.SELF_HOSTED?.toLowerCase();
                     
  const isSelfHosted = selfHosted === "true" || selfHosted === "1";
  
  // Log only on server side to avoid console noise in client
  if (typeof window === 'undefined' && process.env.NODE_ENV !== 'production') {
    console.log(`[FeatureFlags] isCloudHosted check: NEXT_PUBLIC_SELF_HOSTED=${process.env.NEXT_PUBLIC_SELF_HOSTED}, SELF_HOSTED=${process.env.SELF_HOSTED}, result=${!isSelfHosted}`);
  }
  
  return !isSelfHosted;
};

/**
 * Check if Polar payment integration is enabled
 * Requires cloud-hosted mode and proper configuration
 */
export const isPolarEnabled = (): boolean => {
  const enabled = isCloudHosted() && !!process.env.POLAR_ACCESS_TOKEN;
  
  if (typeof window === 'undefined' && process.env.NODE_ENV !== 'production') {
     // console.log(`[FeatureFlags] isPolarEnabled: ${enabled} (Cloud=${isCloudHosted()}, Token=${!!process.env.POLAR_ACCESS_TOKEN})`);
  }
  
  return enabled;
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
