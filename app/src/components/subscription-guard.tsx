"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";
import { useAppConfig } from "@/hooks/use-app-config";

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

/**
 * SubscriptionGuard - Client component that checks subscription status
 * 
 * PERFORMANCE OPTIMIZATION:
 * - Uses cached useAppConfig hook for hosting mode (React Query cached)
 * - Subscription check runs ONCE on mount, not on every navigation
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

  // Use cached hosting mode from React Query (no API call if cached)
  const { isSelfHosted, isLoading: isConfigLoading } = useAppConfig();

  const [isCheckingSubscription, setIsCheckingSubscription] = useState(true);
  const [hasSubscription, setHasSubscription] = useState(false);

  // Track if subscription was already checked this session
  const subscriptionCheckedRef = useRef(false);

  // Check if current route is allowed without subscription
  const isAllowedRoute = ALLOWED_ROUTES_WITHOUT_SUBSCRIPTION.some(
    route => pathname.startsWith(route)
  );

  // Subscription check function - runs once per session
  const checkSubscription = useCallback(async () => {
    // Skip if already checked or if self-hosted
    if (subscriptionCheckedRef.current || isSelfHosted) {
      setIsCheckingSubscription(false);
      return;
    }

    // Skip subscription check for allowed routes
    if (isAllowedRoute) {
      setIsCheckingSubscription(false);
      return;
    }

    try {
      const response = await fetch('/api/billing/current');
      if (response.ok) {
        const data = await response.json();
        // Check if subscription is actually active
        const isActive = data.subscription?.status === 'active' && data.subscription?.plan;
        if (isActive) {
          setHasSubscription(true);
          subscriptionCheckedRef.current = true;
        } else {
          // No active subscription - redirect to subscribe page
          console.log('No active subscription (status:', data.subscription?.status, '), redirecting to subscribe');
          router.push('/subscribe?required=true');
          return;
        }
      } else {
        // API error - redirect to subscribe page
        console.log('Billing API error, redirecting to subscribe');
        router.push('/subscribe?required=true');
        return;
      }
    } catch (error) {
      console.error('Failed to check subscription:', error);
      // On error, redirect to subscribe to be safe
      router.push('/subscribe?required=true');
      return;
    } finally {
      setIsCheckingSubscription(false);
    }
  }, [isSelfHosted, isAllowedRoute, router]);

  // Run subscription check once when config is loaded
  useEffect(() => {
    // Wait for config to load first
    if (isConfigLoading) {
      return;
    }

    // Self-hosted: immediately allow access, no subscription check needed
    if (isSelfHosted) {
      setHasSubscription(true);
      setIsCheckingSubscription(false);
      return;
    }

    // Cloud mode: check subscription once
    checkSubscription();
  }, [isConfigLoading, isSelfHosted, checkSubscription]);

  // Self-hosted mode: always allow access immediately
  if (isSelfHosted) {
    return <>{children}</>;
  }

  // Allowed routes: always allow access
  if (isAllowedRoute) {
    return <>{children}</>;
  }

  // Still loading config or checking subscription in cloud mode
  // Show loading spinner while checking subscription status to prevent
  // exposing protected features before subscription is confirmed
  if (isConfigLoading || isCheckingSubscription) {
    return (
      <div className="flex min-h-[calc(100vh-200px)] items-center justify-center p-4">
        <SuperCheckLoading size="lg" message="Please wait, loading..." />
      </div>
    );
  }

  // Has subscription: render children
  if (hasSubscription) {
    return <>{children}</>;
  }

  // Fallback (should not reach here, but just in case)
  return null;
}
