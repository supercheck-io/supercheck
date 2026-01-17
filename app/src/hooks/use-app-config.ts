import { useQuery } from "@tanstack/react-query";

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
  showCommunityLinks: boolean;
  limits: {
    maxJobNotificationChannels: number;
    maxMonitorNotificationChannels: number;
    recentMonitorResultsLimit?: number;
  };
  statusPage?: {
    domain: string;
  };
}

const DEFAULT_CONFIG: AppConfig = {
  hosting: { selfHosted: true, cloudHosted: false },
  authProviders: {
    github: { enabled: false },
    google: { enabled: false },
  },
  demoMode: false,
  showCommunityLinks: false,
  limits: {
    maxJobNotificationChannels: 10,
    maxMonitorNotificationChannels: 10,
    recentMonitorResultsLimit: undefined,
  },
  statusPage: {
    domain: "supercheck.io",
  },
};

export const APP_CONFIG_QUERY_KEY = ["app-config"] as const;

export async function fetchAppConfig(): Promise<AppConfig> {
  const response = await fetch("/api/config/app");
  if (!response.ok) {
    throw new Error("Failed to fetch app config");
  }
  return response.json();
}

export function useAppConfig() {
  const { data: config, isPending, isFetching, error, isFetched } = useQuery({
    queryKey: APP_CONFIG_QUERY_KEY,
    queryFn: fetchAppConfig,
    // App config rarely changes, cache for 30 min but mark as stale immediately
    // This allows showing cached data while refetching in background
    staleTime: 0,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 2,
  });

  // Use fetched config or default while loading
  const effectiveConfig = config ?? DEFAULT_CONFIG;
  
  // Loading until query completes (isPending is true when no data yet)
  const isLoading = isPending && isFetching;

  return {
    config: effectiveConfig,
    isLoading,
    isFetched,
    error: error as Error | null,
    isSelfHosted: effectiveConfig.hosting?.selfHosted ?? true,
    isCloudHosted: effectiveConfig.hosting?.cloudHosted ?? false,
    isDemoMode: effectiveConfig.demoMode ?? false,
    showCommunityLinks: effectiveConfig.showCommunityLinks ?? false,
    isGithubEnabled: effectiveConfig.authProviders?.github?.enabled ?? false,
    isGoogleEnabled: effectiveConfig.authProviders?.google?.enabled ?? false,
    maxJobNotificationChannels: effectiveConfig.limits?.maxJobNotificationChannels ?? 10,
    maxMonitorNotificationChannels: effectiveConfig.limits?.maxMonitorNotificationChannels ?? 10,
    recentMonitorResultsLimit: effectiveConfig.limits?.recentMonitorResultsLimit,
    statusPageDomain: effectiveConfig.statusPage?.domain ?? "supercheck.io",
  };
}

