/**
 * Auth Providers Hook
 * 
 * Thin wrapper around useAppConfig to check which auth providers are enabled.
 * Uses shared React Query cache - no additional API calls are made.
 */

import { useAppConfig } from "./use-app-config";

/**
 * Hook to check which authentication providers are enabled at runtime
 * 
 * Uses the centralized useAppConfig hook which caches the configuration.
 * This prevents redundant API calls across components.
 */
export function useAuthProviders() {
  const { config, isLoading, error, isGithubEnabled, isGoogleEnabled } = useAppConfig();

  return {
    providers: config?.authProviders ?? {
      github: { enabled: false },
      google: { enabled: false },
    },
    isLoading,
    error,
    isGithubEnabled,
    isGoogleEnabled,
  };
}
