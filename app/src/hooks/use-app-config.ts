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
  const { data: config, isLoading, error, isFetched } = useQuery({
    queryKey: APP_CONFIG_QUERY_KEY,
    queryFn: fetchAppConfig,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: 2,
    initialData: DEFAULT_CONFIG,
    initialDataUpdatedAt: 0,
  });

  const effectiveConfig = config ?? DEFAULT_CONFIG;

  return {
    config: effectiveConfig,
    isLoading: isLoading && !config,
    isFetched,
    error: error as Error | null,
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
