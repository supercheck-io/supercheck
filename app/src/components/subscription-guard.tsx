"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter, usePathname } from "next/navigation";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import { useAppConfig } from "@/hooks/use-app-config";
import { useQuery } from "@tanstack/react-query";

// Hydration-safe mounted check using useSyncExternalStore
const emptySubscribe = () => () => {};
function useHydrated() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

// Routes that don't require subscription
const ALLOWED_ROUTES_WITHOUT_SUBSCRIPTION = [
  '/billing',        // Billing management pages
  '/billing/success', // Post-checkout success page
  '/subscribe',      // Subscription selection page
  '/settings',       // User settings
  '/sign-out',       // Sign out
  '/org-admin',      // Org admin (has its own subscription tab logic)
];

export interface SubscriptionStatus {
  isActive: boolean;
  plan: string | null;
}

interface SubscriptionGuardProps {
  children: React.ReactNode;
  /** Server-provided subscription status to avoid client-side loading overlay */
  initialSubscriptionStatus?: SubscriptionStatus | null;
  /** Server-provided self-hosted flag to avoid waiting for app config fetch */
  initialIsSelfHosted?: boolean;
}

// Query key for subscription status (exported for cache invalidation)
export const SUBSCRIPTION_STATUS_QUERY_KEY = ["subscription-status"] as const;

// Fetch subscription status from lightweight endpoint (exported for prefetching)
export async function fetchSubscriptionStatus(): Promise<SubscriptionStatus> {
  const response = await fetch('/api/subscription/status');
  if (!response.ok) {
    throw new Error('Failed to fetch subscription status');
  }
  return response.json();
}

/**
 * SubscriptionGuard - Client component that checks subscription status
 * 
 * PERFORMANCE:
 * Accepts optional `initialSubscriptionStatus` and `initialIsSelfHosted` from the
 * server layout to eliminate the loading overlay on initial page load. The server
 * layout already fetches org data (which includes subscription fields) and knows the
 * hosting mode from env vars. Passing these avoids two client-side API calls
 * (/api/config/app + /api/subscription/status) on the critical render path.
 * 
 * The client-side React Query still revalidates in the background for cloud routes
 * on mount, so the guard does not stay pinned to the server snapshot for the whole
 * session. Self-hosted mode skips the subscription query entirely.
 * 
 * HYDRATION SAFETY:
 * Always renders {children} to preserve the React tree shape across server and
 * client renders (prevents hydration mismatch with Next.js Suspense boundaries).
 * Loading/blocking UI is shown as an overlay on top of children.
 * The useEffect handles redirects for missing subscriptions in cloud mode.
 * 
 * In cloud mode:
 * - Redirects users without active subscription to billing page
 * - Allows access to billing and settings pages without subscription
 * 
 * In self-hosted mode:
 * - Always allows access (no subscription required)
 */
export function SubscriptionGuard({
  children,
  initialSubscriptionStatus,
  initialIsSelfHosted,
}: SubscriptionGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useHydrated();

  const { isSelfHosted: configSelfHosted, isFetched: isConfigFetched } = useAppConfig();

  // Use server-provided value immediately; fall back to client-fetched config when available
  const isSelfHosted = initialIsSelfHosted ?? configSelfHosted;
  const hasSelfHostedInfo = initialIsSelfHosted !== undefined || isConfigFetched;

  // Check if current route is allowed without subscription
  const isAllowedRoute = ALLOWED_ROUTES_WITHOUT_SUBSCRIPTION.some(
    route => pathname.startsWith(route)
  );

  // Subscription access is dynamic in cloud mode, so this query must override
  // the global 30-minute staleTime/refetchOnMount defaults. Seed with server
  // data for instant paint, then always revalidate once on mount. In known
  // self-hosted mode we can skip the query entirely.
  const shouldQuerySubscriptionStatus =
    !isAllowedRoute && (!hasSelfHostedInfo || !isSelfHosted);

  // Use server-provided initialData to skip loading overlay on first render,
  // then immediately revalidate in the background for cloud routes.
  const { data: subscriptionStatus, isFetched, isError } = useQuery({
    queryKey: SUBSCRIPTION_STATUS_QUERY_KEY,
    queryFn: fetchSubscriptionStatus,
    initialData: initialSubscriptionStatus ?? undefined,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: shouldQuerySubscriptionStatus,
    retry: 2,
  });

  // Handle redirect for users without subscription
  useEffect(() => {
    if (isAllowedRoute) return;
    if (!hasSelfHostedInfo) return;
    if (isSelfHosted) return;
    if (!isFetched) return;

    if (isError) {
      router.push('/subscribe?required=true');
      return;
    }

    if (subscriptionStatus && !subscriptionStatus.isActive) {
      router.push('/subscribe?required=true');
    }
  }, [hasSelfHostedInfo, isSelfHosted, isAllowedRoute, isFetched, isError, subscriptionStatus, router]);

  // Determine if we need to show a loading overlay (only after hydration)
  const needsOverlay = hydrated && !isAllowedRoute && !isSelfHosted && (
    !hasSelfHostedInfo || (!isFetched && !subscriptionStatus?.isActive)
  );

  const loadingMessage = !hasSelfHostedInfo ? "Loading configuration..." : "Checking access...";

  // Always render children to prevent hydration mismatch.
  // Show a full-screen overlay when loading in cloud mode.
  // All API routes have their own server-side auth/subscription checks.
  return (
    <>
      {needsOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
          <SupercheckLoading size="md" message={loadingMessage} />
        </div>
      )}
      {children}
    </>
  );
}
