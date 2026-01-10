/**
 * Unified Application Configuration Hook
 * 
 * Uses React Query for efficient caching - config is fetched once and cached
 * for 5 minutes per session. This prevents excessive API calls on navigation.
 * 
 * All other config hooks (useHostingMode, useAuthProviders) should use this
 * hook internally to share the same cached data.
 */

import { useQuery } from "@tanstack/react-query";

// ============================================================================
// TYPES
// ============================================================================

export interface AppConfig {
  hosting: {
    selfHosted: boolean;
    cloudHosted: boolean;
  };
  authProviders: {
    github: { enabled: boolean };
    google: { enabled: boolean };
  };
  demoMode: boolean;
  limits: {
    maxJobNotificationChannels: number;
    maxMonitorNotificationChannels: number;
    recentMonitorResultsLimit?: number;
  };
  statusPage?: {
    domain: string;
  };
}

// ============================================================================
// DEFAULTS
// ============================================================================

const DEFAULT_CONFIG: AppConfig = {
  hosting: { selfHosted: true, cloudHosted: false },
  authProviders: {
    github: { enabled: false },
    google: { enabled: false },
  },
  demoMode: false,
  limits: {
    maxJobNotificationChannels: 10,
    maxMonitorNotificationChannels: 10,
    recentMonitorResultsLimit: undefined,
  },
  statusPage: {
    domain: "supercheck.io",
  },
};

// ============================================================================
// QUERY KEY (exported for cache invalidation if needed)
// ============================================================================

export const APP_CONFIG_QUERY_KEY = ["app-config"] as const;

// ============================================================================
// FETCH FUNCTION (exported for prefetching)
// ============================================================================

export async function fetchAppConfig(): Promise<AppConfig> {
  const response = await fetch("/api/config/app");
  if (!response.ok) {
    throw new Error("Failed to fetch app config");
  }
  return response.json();
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to fetch unified application configuration at runtime.
 * 
 * Uses React Query for caching with long staleTime (5 minutes).
 * Config rarely changes during a session, so we minimize refetches.
 * 
 * On error, returns safe defaults (self-hosted mode) to avoid blocking users.
 */
export function useAppConfig() {
  const { data: config, isLoading, error, isFetched } = useQuery({
    queryKey: APP_CONFIG_QUERY_KEY,
    queryFn: fetchAppConfig,
    staleTime: 5 * 60 * 1000, // 5 minutes - config rarely changes
    gcTime: 60 * 60 * 1000,  // 60 minutes - config rarely changes during session
    refetchOnWindowFocus: false,
    refetchOnMount: false,    // Use cached data across components
    refetchOnReconnect: false,
    retry: 2,
    // PERFORMANCE: Use initialData for instant render with safe defaults
    // Self-hosted is the safe default (no subscription checks needed)
    initialData: DEFAULT_CONFIG,
    // Mark initial data as stale so it gets refetched
    initialDataUpdatedAt: 0,
  });

  // Use config or defaults
  const effectiveConfig = config ?? DEFAULT_CONFIG;

  return {
    config: effectiveConfig,
    // PERFORMANCE: isLoading is false when we have initialData
    // Use isFetched to know when real data is available
    isLoading: isLoading && !config,
    isFetched,
    error: error as Error | null,
    // Convenience accessors with safe defaults
    isSelfHosted: effectiveConfig.hosting?.selfHosted ?? true,
    isCloudHosted: effectiveConfig.hosting?.cloudHosted ?? false,
    isDemoMode: effectiveConfig.demoMode ?? false,
    isGithubEnabled: effectiveConfig.authProviders?.github?.enabled ?? false,
    isGoogleEnabled: effectiveConfig.authProviders?.google?.enabled ?? false,
    maxJobNotificationChannels: effectiveConfig.limits?.maxJobNotificationChannels ?? 10,
    maxMonitorNotificationChannels: effectiveConfig.limits?.maxMonitorNotificationChannels ?? 10,
    recentMonitorResultsLimit: effectiveConfig.limits?.recentMonitorResultsLimit,
    statusPageDomain: effectiveConfig.statusPage?.domain ?? "supercheck.io",
  };
}
