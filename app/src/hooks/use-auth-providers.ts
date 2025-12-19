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
  const { config, isFetched, error, isGithubEnabled, isGoogleEnabled } = useAppConfig();

  return {
    providers: config?.authProviders ?? {
      github: { enabled: false },
      google: { enabled: false },
    },
    // IMPORTANT: For auth pages, we need to wait for real config before showing/hiding buttons
    // isLoading is false immediately due to initialData, so we use !isFetched instead
    isLoading: !isFetched,
    error,
    isGithubEnabled,
    isGoogleEnabled,
  };
}
