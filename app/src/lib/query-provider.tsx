"use client";

import { QueryClient, QueryClientProvider, isServer } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { ReactNode, useEffect, useRef } from "react";

const CACHE_KEY = "supercheck-cache-v1";
const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const STALE_TIME = 30 * 60 * 1000;  // 30 minutes - data is fresh for this long

// Module-level singleton for browser
let browserClient: QueryClient | undefined;
let persistenceInitialized = false;

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // GLOBAL DEFAULTS - consistent across all hooks
        staleTime: STALE_TIME,           // 30 minutes - data considered fresh
        gcTime: MAX_AGE,                 // 24 hours - cache garbage collection
        retry: 2,                        // Retry failed requests twice
        refetchOnWindowFocus: false,     // Don't refetch on tab focus
        refetchOnMount: false,           // Use cached data on mount
        refetchOnReconnect: false,       // Don't refetch on network reconnect
      },
    },
  });
}

function getClient() {
  if (isServer) return createClient();
  if (!browserClient) {
    browserClient = createClient();
  }
  return browserClient;
}

// Initialize persistence - called once on client
function initPersistence(client: QueryClient) {
  if (typeof window === "undefined" || persistenceInitialized) return;
  
  try {
    const persister = createSyncStoragePersister({
      storage: window.localStorage,
      key: CACHE_KEY,
      throttleTime: 500,
    });

    // persistQueryClient handles both restoration and subscription
    // For sync persisters, restoration happens immediately (synchronously)
    persistQueryClient({
      queryClient: client,
      persister,
      maxAge: MAX_AGE,
      dehydrateOptions: {
        shouldDehydrateQuery: (query) => {
          // Only persist successful queries with data
          return query.state.status === "success" && query.state.data !== undefined;
        },
      },
    });

    persistenceInitialized = true;
  } catch (error) {
    console.error("Failed to initialize query persistence:", error);
    // Clear potentially corrupted cache
    try {
      window.localStorage.removeItem(CACHE_KEY);
    } catch { /* ignore */ }
  }
}

export function clearQueryCache() {
  if (typeof window === "undefined") return;
  browserClient?.clear();
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch { /* ignore */ }
  persistenceInitialized = false;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const client = getClient();
  const initialized = useRef(false);

  // Initialize persistence on mount (client-side only)
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      initPersistence(client);
    }
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
