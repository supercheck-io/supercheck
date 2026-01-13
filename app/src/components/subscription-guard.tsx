"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";
import { useAppConfig } from "@/hooks/use-app-config";
import { useQuery } from "@tanstack/react-query";

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
 * PERFORMANCE OPTIMIZATION:
 * - Uses React Query for subscription status (cached for 5 minutes)
 * - Uses cached useAppConfig hook for hosting mode (React Query cached)
 * - Does NOT block rendering for cached data - instant navigation
 * - Self-hosted mode bypasses all subscription checks immediately
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

  // isSelfHosted starts as true, allowing immediate render
  // When real config loads, if cloud mode, subscription check triggers
  const { isSelfHosted, isFetched: isConfigFetched } = useAppConfig();

  // Check if current route is allowed without subscription
  const isAllowedRoute = ALLOWED_ROUTES_WITHOUT_SUBSCRIPTION.some(
    route => pathname.startsWith(route)
  );

  // DataPrefetcher may have already populated this cache
  const { data: subscriptionStatus, isLoading: isSubscriptionLoading, isFetched } = useQuery({
    queryKey: SUBSCRIPTION_STATUS_QUERY_KEY,
    queryFn: fetchSubscriptionStatus,
    // Long stale time - subscription status rarely changes mid-session
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 60 * 60 * 1000,  // 60 minutes - subscription rarely changes during session
    // CRITICAL: Don't refetch on mount if we have cached data
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // We check isSelfHosted in the render logic, not here
    // This allows the query to start immediately via prefetch
    enabled: !isAllowedRoute,
    retry: 2,
  });

  // Handle redirect for users without subscription
  useEffect(() => {
    // Skip if allowed route
    if (isAllowedRoute) return;

    // initialData gives us self-hosted=true, but we need real config
    if (!isConfigFetched) return;

    // Skip if self-hosted mode (no subscription required)
    if (isSelfHosted) return;

    // Skip if subscription check hasn't completed yet
    if (!isFetched) return;

    // If subscription is not active, redirect to subscribe page
    if (subscriptionStatus && !subscriptionStatus.isActive) {
      console.log('No active subscription, redirecting to subscribe');
      router.push('/subscribe?required=true');
    }
  }, [isConfigFetched, isSelfHosted, isAllowedRoute, isFetched, subscriptionStatus, router]);

  // Allowed routes: always allow access immediately
  if (isAllowedRoute) {
    return <>{children}</>;
  }

  // SECURITY: Must wait for config to be fetched before making decisions
  // This prevents briefly showing content in cloud mode before we know hosting mode
  // Self-hosted: isSelfHosted stays true, renders immediately
  // Cloud: Initially isSelfHosted=true from initialData, renders immediately
  //        When real config loads, isSelfHosted=false, subscription check triggers redirect
  if (!isConfigFetched && !isSelfHosted) {
    return (
      <div className="flex min-h-[calc(100vh-200px)] items-center justify-center p-4">
        <SuperCheckLoading size="lg" message="Loading configuration..." />
      </div>
    );
  }

  // Config is fetched - now we know the real hosting mode

  // Self-hosted mode: always allow access (no subscription required)
  if (isSelfHosted) {
    return <>{children}</>;
  }

  // Cloud mode: Need to verify subscription

  if (subscriptionStatus?.isActive) {
    return <>{children}</>;
  }

  // Subscription data loading or not yet fetched
  if (!isFetched || isSubscriptionLoading) {
    return (
      <div className="flex min-h-[calc(100vh-200px)] items-center justify-center p-4">
        <SuperCheckLoading size="lg" message="Checking access..." />
      </div>
    );
  }

  // Subscription check completed but not active - show loading while redirect happens
  // This prevents briefly exposing protected content
  if (!subscriptionStatus?.isActive) {
    return (
      <div className="flex min-h-[calc(100vh-200px)] items-center justify-center p-4">
        <SuperCheckLoading size="lg" message="Checking access..." />
      </div>
    );
  }

  // Fallback while waiting for data
  return null;
}
