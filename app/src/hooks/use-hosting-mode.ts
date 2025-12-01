import { useEffect, useState } from "react";

interface HostingMode {
  selfHosted: boolean;
  cloudHosted: boolean;
}

/**
 * Hook to check the hosting mode (self-hosted vs cloud)
 * Uses the unified /api/config/app endpoint for runtime configuration
 *
 * This hook should be used to conditionally show UI elements based on deployment mode
 */
export function useHostingMode() {
  const [hostingMode, setHostingMode] = useState<HostingMode | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchHostingMode = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch("/api/config/app");
        if (!response.ok) {
          throw new Error("Failed to fetch app config");
        }

        const data = await response.json();
        setHostingMode({
          selfHosted: data.hosting?.selfHosted ?? true,
          cloudHosted: data.hosting?.cloudHosted ?? false,
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Unknown error");
        setError(error);
        // Default to self-hosted on error (fail-safe approach)
        setHostingMode({
          selfHosted: true,
          cloudHosted: false,
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchHostingMode();
  }, []);

  return {
    hostingMode,
    isLoading,
    error,
    isSelfHosted: hostingMode?.selfHosted ?? true,
    isCloudHosted: hostingMode?.cloudHosted ?? false,
  };
}
