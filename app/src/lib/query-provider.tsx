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
            // PERFORMANCE: Conservative defaults to prevent excessive refetching
            staleTime: 60 * 1000, // 1 minute
            gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
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
