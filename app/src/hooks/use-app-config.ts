import { useEffect, useState } from "react";

interface AppConfig {
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
};

/**
 * Hook to fetch unified application configuration at runtime
 * Replaces build-time NEXT_PUBLIC_* environment variables
 */
export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch("/api/config/app");
        if (!response.ok) {
          throw new Error("Failed to fetch app config");
        }

        const data = await response.json();
        setConfig(data);
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Unknown error");
        setError(error);
        // Use defaults on error (fail-safe)
        setConfig(DEFAULT_CONFIG);
      } finally {
        setIsLoading(false);
      }
    };

    fetchConfig();
  }, []);

  return {
    config,
    isLoading,
    error,
    // Convenience accessors
    isSelfHosted: config?.hosting?.selfHosted ?? true,
    isCloudHosted: config?.hosting?.cloudHosted ?? false,
    isDemoMode: config?.demoMode ?? false,
    isGithubEnabled: config?.authProviders?.github?.enabled ?? false,
    isGoogleEnabled: config?.authProviders?.google?.enabled ?? false,
    maxJobNotificationChannels: config?.limits?.maxJobNotificationChannels ?? 10,
    maxMonitorNotificationChannels: config?.limits?.maxMonitorNotificationChannels ?? 10,
    recentMonitorResultsLimit: config?.limits?.recentMonitorResultsLimit,
  };
}
