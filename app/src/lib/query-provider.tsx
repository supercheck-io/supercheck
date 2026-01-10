/**
 * React Query Provider Setup
 * Configures TanStack Query for the application
 */

"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, ReactNode } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Default options for all queries
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
            // Default options for all mutations
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
