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
import { useSession } from "@/utils/auth-client";

// Bump the version when a persisted query changes shape; older stores are removed on load.
const CACHE_KEY = "supercheck-cache-v3";
const CACHE_KEY_PREFIX = "supercheck-cache-";
const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const STALE_TIME = 30 * 60 * 1000; // 30 minutes - data is fresh for this long

// Share the browser cache across providers and client navigations.
let browserClient: QueryClient | undefined;
let browserIdentity: string | null | undefined;
let unsubscribePersistence: (() => void) | undefined;
let restorationPromise: Promise<void> | undefined;
// Set when another tab removed this identity's saved cache (it signed out): until this tab's identity
// changes, nothing may write that cache back, even if this tab still shows the old data for a moment.
let cacheClearedByOtherTab = false;
let stopWatchingCacheKey: (() => void) | undefined;

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

// A cache is only cleared when its own tab sees the session end, so an expired session or a
// closed browser leaves that account's data in localStorage. Anyone using the browser next could
// read it, so keep only the identity that is signed in now (and no older cache versions).
function pruneCaches(storage: Storage, keep?: string) {
  try {
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(CACHE_KEY_PREFIX) && key !== keep) stale.push(key);
    }
    stale.forEach((key) => storage.removeItem(key));
  } catch {
    /* pruning is best effort: it must not stop this account's own cache from working */
  }
}

function initializePersistence(
  client: QueryClient,
  identity: string,
): Promise<void> {
  try {
    const storage = window.localStorage;
    pruneCaches(storage, `${CACHE_KEY}:${identity}`);
    cacheClearedByOtherTab = false;
    stopWatchingCacheKey?.();
    const ownKey = `${CACHE_KEY}:${identity}`;
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === storage && event.key === ownKey && event.newValue === null) {
        cacheClearedByOtherTab = true;
      }
    };
    window.addEventListener("storage", onStorage);
    stopWatchingCacheKey = () => window.removeEventListener("storage", onStorage);
    const persister = createSyncStoragePersister({
      storage: {
        getItem: (key) => storage.getItem(key),
        setItem: (key, value) => {
          // A throttled save must not restore a signed-out user's cache, here or in another tab.
          if (browserClient === client && !cacheClearedByOtherTab) storage.setItem(key, value);
        },
        removeItem: (key) => storage.removeItem(key),
      },
      key: `${CACHE_KEY}:${identity}`,
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
      window.localStorage.removeItem(`${CACHE_KEY}:${identity}`);
    } catch {
      /* ignore */
    }
  }

  return Promise.resolve();
}

function getClient(identity: string | null) {
  if (isServer) return createClient();

  if (browserIdentity !== identity) {
    clearQueryCache();
    browserIdentity = identity;
  }

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

  stopWatchingCacheKey?.();
  stopWatchingCacheKey = undefined;
  browserClient?.clear();

  try {
    pruneCaches(window.localStorage);
  } catch {
    /* ignore */
  }

  // Reset client so next getClient() creates fresh one with persistence
  browserClient = undefined;
  restorationPromise = undefined;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const identity = session.data?.user.id ?? null;
  return (
    <IdentityQueryProvider
      key={identity ?? "anonymous"}
      identity={identity}
      pending={session.isPending}
    >
      {children}
    </IdentityQueryProvider>
  );
}

function IdentityQueryProvider({
  children,
  identity,
  pending,
}: {
  children: ReactNode;
  identity: string | null;
  pending: boolean;
}) {
  const client = getClient(identity);
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    // Server and first client render both use an empty cache. Restore only
    // after mount, with queries paused until the saved cache is ready.
    if (pending) return;
    if (!identity) {
      setIsRestoring(false);
      return;
    }
    restorationPromise ??= initializePersistence(client, identity);
    void restorationPromise.then(
      () => setIsRestoring(false),
      () => setIsRestoring(false),
    );
  }, [client, identity, pending]);

  return (
    <QueryClientProvider client={client}>
      <IsRestoringProvider value={isRestoring}>{children}</IsRestoringProvider>
    </QueryClientProvider>
  );
}
