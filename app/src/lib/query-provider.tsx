/**
 * React Query Provider Setup
 * Configures TanStack Query for the application with localStorage persistence
 * 
 * PERFORMANCE OPTIMIZATION:
 * - Data persists to localStorage for instant load on subsequent visits
 * - Session-long in-memory caching prevents refetching during navigation
 * - Stale-while-revalidate pattern shows cached data immediately
 * 
 * ARCHITECTURE:
 * - Uses module-level singleton for browser QueryClient
 * - Restores cache from localStorage synchronously on initial load
 * - Subscribes to cache changes for persistence
 */

"use client";

import { QueryClient, QueryClientProvider, isServer } from "@tanstack/react-query";
import { 
  persistQueryClientRestore, 
  persistQueryClientSubscribe 
} from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { ReactNode, useRef, useEffect } from "react";

// ============================================================================
// QUERY CLIENT CONFIGURATION
// ============================================================================

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // PERFORMANCE: Session-long caching - data stays in memory
        // Individual hooks can override these defaults as needed
        staleTime: 5 * 60 * 1000, // 5 minutes - prevents aggressive background refetching
        gcTime: 24 * 60 * 60 * 1000, // 24 hours - keeps data in memory for entire session
        retry: 2,
        refetchOnWindowFocus: false,
        // CRITICAL: Don't refetch on mount if data exists - prevents duplicate calls on navigation
        refetchOnMount: false,
        refetchOnReconnect: false,
      },
      mutations: {
        retry: 1,
      },
    },
  });
}

// ============================================================================
// BROWSER SINGLETON
// ============================================================================

/**
 * Browser-side QueryClient singleton
 * 
 * CRITICAL: We must use a module-level singleton for the browser to:
 * 1. Prevent re-creating the client during React suspense initial render
 * 2. Share cache across all components during client-side navigation
 * 3. Ensure persistence writes to the same client instance
 */
let browserQueryClient: QueryClient | undefined = undefined;

/**
 * Track if we've already restored the cache from localStorage
 * This ensures we only restore once per session
 */
let cacheRestored = false;

function getQueryClient() {
  if (isServer) {
    // Server: always make a new query client to prevent data leakage between requests
    return makeQueryClient();
  } else {
    // Browser: reuse existing client to maintain cache across navigations
    if (!browserQueryClient) {
      browserQueryClient = makeQueryClient();
      
      // CRITICAL: Restore cache from localStorage SYNCHRONOUSLY
      // This must happen BEFORE any queries run
      if (!cacheRestored && typeof window !== "undefined") {
        try {
          const persister = createSyncStoragePersister({
            storage: window.localStorage,
            key: "supercheck-query-cache",
          });
          
          // Synchronously restore cache from localStorage
          persistQueryClientRestore({
            queryClient: browserQueryClient,
            persister,
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
          });
          
          cacheRestored = true;
        } catch (error) {
          console.warn("[QueryProvider] Failed to restore cache from localStorage:", error);
        }
      }
    }
    return browserQueryClient;
  }
}

// ============================================================================
// PERSISTER SETUP
// ============================================================================

/**
 * Create persister for saving cache changes to localStorage
 */
function createPersister() {
  if (typeof window === "undefined") return null;
  
  return createSyncStoragePersister({
    storage: window.localStorage,
    key: "supercheck-query-cache",
    // Throttle writes to localStorage to prevent performance issues
    throttleTime: 1000,
    // Serialize/deserialize functions handle Date objects and other types
    serialize: (data) => JSON.stringify(data),
    deserialize: (data) => JSON.parse(data),
  });
}

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

export function QueryProvider({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  const subscriptionRef = useRef<(() => void) | null>(null);
  
  // Subscribe to cache changes for persistence (only once per mount)
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    const persister = createPersister();
    if (!persister) return;
    
    // Subscribe to cache changes and persist them to localStorage
    // This runs AFTER initial hydration, so it won't cause hydration mismatch
    subscriptionRef.current = persistQueryClientSubscribe({
      queryClient,
      persister,
      dehydrateOptions: {
        shouldDehydrateQuery: (query) => {
          // Don't persist queries with errors
          if (query.state.status === "error") return false;
          // Don't persist queries that are still loading
          if (query.state.status === "pending") return false;
          // Persist all successful queries
          return true;
        },
      },
    });
    
    return () => {
      // Cleanup subscription on unmount
      if (subscriptionRef.current) {
        subscriptionRef.current();
      }
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
