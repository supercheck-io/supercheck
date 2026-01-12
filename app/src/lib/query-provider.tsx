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
 * - Restores cache synchronously on first browser render
 * - Subscribes to cache changes for persistence after mount
 * 
 * HYDRATION FIX (2025):
 * We use standard QueryClientProvider (not PersistQueryClientProvider) to avoid
 * hydration mismatches. PersistQueryClientProvider sets isRestoring=true on client
 * during restoration, which differs from server (always false), causing hydration errors.
 * 
 * Instead, we restore cache synchronously BEFORE React renders using module-level
 * initialization, then subscribe to changes in useEffect AFTER hydration completes.
 */

"use client";

import { QueryClient, QueryClientProvider, isServer } from "@tanstack/react-query";
import { 
  persistQueryClientRestore, 
  persistQueryClientSubscribe 
} from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { ReactNode, useEffect, useRef } from "react";

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
// BROWSER SINGLETON WITH SYNCHRONOUS CACHE RESTORATION
// ============================================================================

/**
 * Storage key for React Query cache in localStorage
 * Used for both storing and clearing cache data
 */
const CACHE_STORAGE_KEY = "supercheck-query-cache";

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

/**
 * Get or create the QueryClient singleton
 * 
 * CRITICAL: On browser, this restores cache from localStorage SYNCHRONOUSLY
 * before returning the client. This ensures cached data is available
 * immediately when components render, preventing loading spinners.
 */
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
            key: CACHE_STORAGE_KEY,
          });
          
          // Synchronously restore cache from localStorage
          // This populates the QueryClient cache before React renders
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
// PERSISTER FOR SAVING CHANGES
// ============================================================================

/**
 * Create persister for saving cache changes to localStorage
 * 
 * This is separate from the restore persister to allow independent configuration.
 */
function createPersister() {
  if (typeof window === "undefined") return null;
  
  return createSyncStoragePersister({
    storage: window.localStorage,
    key: CACHE_STORAGE_KEY,
    // Throttle writes to localStorage to prevent performance issues
    throttleTime: 1000,
    // Serialize/deserialize functions handle Date objects and other types
    serialize: (data) => JSON.stringify(data),
    deserialize: (data) => JSON.parse(data),
  });
}

// ============================================================================
// CACHE CLEARING FOR SIGN OUT
// ============================================================================

/**
 * Clear all React Query cache data from memory and localStorage
 * 
 * SECURITY: Must be called on sign out to prevent data leakage between users.
 * Clears both:
 * - In-memory QueryClient cache
 * - localStorage persisted cache
 */
export function clearQueryCache() {
  if (typeof window === "undefined") return;
  
  try {
    // Clear in-memory cache
    if (browserQueryClient) {
      browserQueryClient.clear();
    }
    
    // Clear localStorage cache
    window.localStorage.removeItem(CACHE_STORAGE_KEY);
    
    // Reset restoration flag so next user can restore their cache
    cacheRestored = false;
  } catch (error) {
    console.warn("[QueryProvider] Failed to clear cache:", error);
  }
}

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

/**
 * React Query Provider with localStorage persistence
 * 
 * HYDRATION-SAFE IMPLEMENTATION:
 * - Uses standard QueryClientProvider (not PersistQueryClientProvider)
 * - Cache is restored SYNCHRONOUSLY in getQueryClient() BEFORE React renders
 * - Subscription for saving changes happens in useEffect AFTER hydration
 * 
 * This approach ensures:
 * 1. Server and client render the same content (no isRestoring difference)
 * 2. Cached data is available immediately on first render
 * 3. No hydration mismatches from conditional rendering
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  const subscriptionRef = useRef<(() => void) | null>(null);
  
  // Subscribe to cache changes for persistence AFTER hydration
  // This runs only on client, after React has hydrated
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    const persister = createPersister();
    if (!persister) return;
    
    // Subscribe to cache changes and persist them to localStorage
    // This runs AFTER hydration, so it won't cause hydration mismatch
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
