"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter, usePathname } from "next/navigation";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";
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

interface SubscriptionGuardProps {
  children: React.ReactNode;
}

// Query key for subscription status (exported for cache invalidation)
export const SUBSCRIPTION_STATUS_QUERY_KEY = ["subscription-status"] as const;

// Fetch subscription status (exported for prefetching)
export async function fetchSubscriptionStatus(): Promise<{ isActive: boolean; plan: string | null }> {
  const response = await fetch('/api/billing/current');
  if (!response.ok) {
    throw new Error('Failed to fetch subscription status');
  }
  const data = await response.json();
  const isActive = data.subscription?.status === 'active' && data.subscription?.plan;
  return {
    isActive: !!isActive,
    plan: data.subscription?.plan || null,
  };
}

/**
 * SubscriptionGuard - Client component that checks subscription status
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
export function SubscriptionGuard({ children }: SubscriptionGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useHydrated();

  const { isSelfHosted, isFetched: isConfigFetched } = useAppConfig();

  // Check if current route is allowed without subscription
  const isAllowedRoute = ALLOWED_ROUTES_WITHOUT_SUBSCRIPTION.some(
    route => pathname.startsWith(route)
  );

  // DataPrefetcher may have already populated this cache
  const { data: subscriptionStatus, isFetched, isError } = useQuery({
    queryKey: SUBSCRIPTION_STATUS_QUERY_KEY,
    queryFn: fetchSubscriptionStatus,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: !isAllowedRoute,
    retry: 2,
  });

  // Handle redirect for users without subscription
  useEffect(() => {
    if (isAllowedRoute) return;
    if (!isConfigFetched) return;
    if (isSelfHosted) return;
    if (!isFetched) return;

    if (isError) {
      router.push('/subscribe?required=true');
      return;
    }

    if (subscriptionStatus && !subscriptionStatus.isActive) {
      router.push('/subscribe?required=true');
    }
  }, [isConfigFetched, isSelfHosted, isAllowedRoute, isFetched, isError, subscriptionStatus, router]);

  // Determine if we need to show a loading overlay (only after hydration)
  const needsOverlay = hydrated && !isAllowedRoute && !isSelfHosted && (
    !isConfigFetched || (!isFetched && !subscriptionStatus?.isActive)
  );

  const loadingMessage = !isConfigFetched ? "Loading configuration..." : "Checking access...";

  // Always render children to prevent hydration mismatch.
  // Show a full-screen overlay when loading in cloud mode.
  // All API routes have their own server-side auth/subscription checks.
  return (
    <>
      {needsOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
          <SuperCheckLoading size="md" message={loadingMessage} />
        </div>
      )}
      {children}
    </>
  );
}
