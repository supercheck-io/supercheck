/**
 * Hosting Mode Hook
 * 
 * Thin wrapper around useAppConfig to check hosting mode (self-hosted vs cloud).
 * Uses shared React Query cache - no additional API calls are made.
 * 
 * Use this hook to conditionally show UI elements based on deployment mode.
 */

import { useAppConfig } from "./use-app-config";

/**
 * Hook to check the hosting mode (self-hosted vs cloud)
 * 
 * Uses the centralized useAppConfig hook which caches the configuration.
 * This prevents redundant API calls across components.
 */
export function useHostingMode() {
  const { config, isLoading, error, isSelfHosted, isCloudHosted } = useAppConfig();

  return {
    hostingMode: config?.hosting ?? { selfHosted: true, cloudHosted: false },
    isLoading,
    error,
    isSelfHosted,
    isCloudHosted,
  };
}
