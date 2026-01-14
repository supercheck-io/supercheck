"use client";

import { QueryClient, QueryClientProvider, isServer } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { ReactNode } from "react";

const CACHE_KEY = "supercheck-cache-v1";
const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const STALE_TIME = 30 * 60 * 1000;  // 30 minutes - data is fresh for this long

// Module-level singleton for browser - initialized ONCE with persistence
let browserClient: QueryClient | undefined;
let unsubscribePersistence: (() => void) | undefined;

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

// Initialize persistence SYNCHRONOUSLY when client is created
// This ensures cache is restored BEFORE any queries run
function initializeClientWithPersistence(): QueryClient {
  const client = createClient();
  
  if (typeof window === "undefined") return client;
  
  try {
    const persister = createSyncStoragePersister({
      storage: window.localStorage,
      key: CACHE_KEY,
      throttleTime: 500,
    });

    // For sync storage persisters, persistQueryClient:
    // 1. Synchronously restores cache from localStorage IMMEDIATELY
    // 2. Sets up subscription to persist future changes
    // 3. Returns unsubscribe function
    const [unsubscribe] = persistQueryClient({
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

    unsubscribePersistence = unsubscribe;
  } catch (error) {
    console.error("Failed to initialize query persistence:", error);
    // Clear potentially corrupted cache
    try {
      window.localStorage.removeItem(CACHE_KEY);
    } catch { /* ignore */ }
  }
  
  return client;
}

function getClient() {
  if (isServer) return createClient();
  
  // Create client with persistence ONCE - cache is restored synchronously
  if (!browserClient) {
    browserClient = initializeClientWithPersistence();
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
  } catch { /* ignore */ }
  
  // Reset client so next getClient() creates fresh one with persistence
  browserClient = undefined;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  // getClient() returns singleton with cache already restored from localStorage
  // No useEffect needed - persistence is initialized synchronously
  const client = getClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
