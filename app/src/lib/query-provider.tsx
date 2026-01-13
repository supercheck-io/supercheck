"use client";

import { QueryClient, QueryClientProvider, isServer, hydrate } from "@tanstack/react-query";
import { persistQueryClientSubscribe, type PersistedClient, type Persister } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { ReactNode, useEffect, useRef } from "react";

const CACHE_KEY = "supercheck-cache-v1";
const MAX_AGE = 24 * 60 * 60 * 1000;

let browserClient: QueryClient | undefined;
let restored = false;
let persister: Persister | null = null;

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: MAX_AGE,
        retry: 2,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
      },
    },
  });
}

function getPersister(): Persister | null {
  if (typeof window === "undefined") return null;
  if (!persister) {
    persister = createSyncStoragePersister({
      storage: window.localStorage,
      key: CACHE_KEY,
      throttleTime: 1000,
    });
  }
  return persister;
}

function restoreCache(client: QueryClient) {
  if (restored || typeof window === "undefined") return;
  
  try {
    const p = getPersister() as { restoreClient?: () => PersistedClient | undefined };
    if (!p?.restoreClient) return;
    
    const data = p.restoreClient();
    if (!data?.clientState) return;
    
    const age = data.timestamp ? Date.now() - data.timestamp : Infinity;
    if (age > MAX_AGE) {
      window.localStorage.removeItem(CACHE_KEY);
      return;
    }
    
    hydrate(client, data.clientState);
  } catch {
    // Ignore
  } finally {
    restored = true;
  }
}

function getClient() {
  if (isServer) return createClient();
  
  if (!browserClient) {
    browserClient = createClient();
    restoreCache(browserClient);
  }
  
  return browserClient;
}

export function clearQueryCache() {
  if (typeof window === "undefined") return;
  browserClient?.clear();
  window.localStorage.removeItem(CACHE_KEY);
  restored = false;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const client = getClient();
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const p = getPersister();
    if (!p) return;

    unsubRef.current = persistQueryClientSubscribe({
      queryClient: client,
      persister: p,
      dehydrateOptions: {
        shouldDehydrateQuery: (q) => q.state.status === "success",
      },
    });

    return () => unsubRef.current?.();
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
