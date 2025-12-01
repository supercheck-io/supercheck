import { useEffect, useState } from "react";

interface AuthProviders {
  github: {
    enabled: boolean;
  };
  google: {
    enabled: boolean;
  };
}

/**
 * Hook to check which authentication providers are enabled at runtime
 * Uses the unified /api/config/app endpoint for runtime configuration
 */
export function useAuthProviders() {
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch("/api/config/app");
        if (!response.ok) {
          throw new Error("Failed to fetch app config");
        }

        const data = await response.json();
        setProviders({
          github: { enabled: data.authProviders?.github?.enabled ?? false },
          google: { enabled: data.authProviders?.google?.enabled ?? false },
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Unknown error");
        setError(error);
        // Default to disabled on error (fail-safe approach)
        setProviders({
          github: { enabled: false },
          google: { enabled: false },
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchProviders();
  }, []);

  return {
    providers,
    isLoading,
    error,
    isGithubEnabled: providers?.github?.enabled ?? false,
    isGoogleEnabled: providers?.google?.enabled ?? false,
  };
}
