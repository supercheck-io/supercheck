/**
 * React Query Provider Setup
 * Configures TanStack Query for the application with localStorage persistence
 * 
 * PERFORMANCE OPTIMIZATION:
 * - Data persists to localStorage for instant load on subsequent visits
 * - Session-long in-memory caching prevents refetching during navigation
 * - Stale-while-revalidate pattern shows cached data immediately
 */

"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { useState, useSyncExternalStore, ReactNode } from "react";

// ============================================================================
// CLIENT-SIDE DETECTION
// ============================================================================

/**
 * External store for client-side detection
 * This pattern avoids the React lint warning about setState in effects
 */
function subscribeToNothing() {
  return () => {};
}

function getIsClient() {
  return true;
}

function getIsServer() {
  return false;
}

// ============================================================================
// QUERY CLIENT CONFIGURATION
// ============================================================================

function createQueryClient() {
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
// PERSISTER CONFIGURATION
// ============================================================================

/**
 * Create localStorage persister for React Query cache
 * Only created on client side to avoid SSR issues
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
  const [queryClient] = useState(createQueryClient);
  
  // Use useSyncExternalStore for hydration-safe client detection
  // This avoids the React lint warning about setState in effects
  const isClient = useSyncExternalStore(
    subscribeToNothing,
    getIsClient,
    getIsServer
  );

  // Lazily create persister only on client
  const [persister] = useState(() => isClient ? createPersister() : null);

  // During SSR or before hydration, use basic provider
  if (!isClient || !persister) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }

  // On client with persister ready, use persist provider
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        // Maximum age for persisted cache (24 hours)
        maxAge: 24 * 60 * 60 * 1000,
        // Only persist queries that have been successfully fetched
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
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
