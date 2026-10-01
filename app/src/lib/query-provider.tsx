"use client";

import {
  QueryClient,
  QueryClientProvider,
  IsRestoringProvider,
  isServer,
} from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { ReactNode, useEffect, useState } from "react";

const CACHE_KEY = "supercheck-cache-v1";
const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const STALE_TIME = 30 * 60 * 1000; // 30 minutes - data is fresh for this long

// Share the browser cache across providers and client navigations.
let browserClient: QueryClient | undefined;
let unsubscribePersistence: (() => void) | undefined;
let restorationPromise: Promise<void> | undefined;

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // GLOBAL DEFAULTS - consistent across all hooks
        staleTime: STALE_TIME, // 30 minutes - data considered fresh
        gcTime: MAX_AGE, // 24 hours - cache garbage collection
        retry: 2, // Retry failed requests twice
        refetchOnWindowFocus: false, // Don't refetch on tab focus
        refetchOnMount: false, // Use cached data on mount
        refetchOnReconnect: false, // Don't refetch on network reconnect
      },
    },
  });
}

function initializePersistence(client: QueryClient): Promise<void> {
  try {
    const storage = window.localStorage;
    const persister = createSyncStoragePersister({
      storage: {
        getItem: (key) => storage.getItem(key),
        setItem: (key, value) => {
          // A throttled save must not restore a signed-out user's cache.
          if (browserClient === client) storage.setItem(key, value);
        },
        removeItem: (key) => storage.removeItem(key),
      },
      key: CACHE_KEY,
      throttleTime: 500,
    });

    // Keep the unsubscribe handle for sign-out and identity changes.
    const [unsubscribe, restored] = persistQueryClient({
      queryClient: client,
      persister,
      maxAge: MAX_AGE,
      dehydrateOptions: {
        shouldDehydrateQuery: (query) => {
          if (query.meta?.persist === false) return false;
          // Only persist successful queries with data
          return (
            query.state.status === "success" && query.state.data !== undefined
          );
        },
      },
    });

    unsubscribePersistence = unsubscribe;
    return restored;
  } catch (error) {
    console.error("Failed to initialize query persistence:", error);
    // Clear potentially corrupted cache
    try {
      window.localStorage.removeItem(CACHE_KEY);
    } catch {
      /* ignore */
    }
  }

  return Promise.resolve();
}

function getClient() {
  if (isServer) return createClient();

  if (!browserClient) {
    browserClient = createClient();
  }
  return browserClient;
}

export function clearQueryCache() {
  if (typeof window === "undefined") return;

  // Unsubscribe from persistence to prevent re-persisting cleared cache
  if (unsubscribePersistence) {
    unsubscribePersistence();
    unsubscribePersistence = undefined;
  }

  browserClient?.clear();

  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }

  // Reset client so next getClient() creates fresh one with persistence
  browserClient = undefined;
  restorationPromise = undefined;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const client = getClient();
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    // Server and first client render both use an empty cache. Restore only
    // after mount, with queries paused until the saved cache is ready.
    restorationPromise ??= initializePersistence(client);
    void restorationPromise.then(
      () => setIsRestoring(false),
      () => setIsRestoring(false),
    );
  }, [client]);

  return (
    <QueryClientProvider client={client}>
      <IsRestoringProvider value={isRestoring}>{children}</IsRestoringProvider>
    </QueryClientProvider>
  );
}
