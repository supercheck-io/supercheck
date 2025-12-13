"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";

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
  const [isChecking, setIsChecking] = useState(true);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [isSelfHosted, setIsSelfHosted] = useState<boolean | null>(null);

  useEffect(() => {
    const checkHostingModeAndSubscription = async () => {
      // First, check hosting mode from server (runtime env var)
      try {
        const modeResponse = await fetch('/api/config/hosting-mode');
        if (modeResponse.ok) {
          const modeData = await modeResponse.json();
          setIsSelfHosted(modeData.selfHosted);

          // Self-hosted mode: skip subscription check
          if (modeData.selfHosted) {
            setHasSubscription(true);
            setIsChecking(false);
            return;
          }
        }
      } catch (error) {
        console.error('Failed to check hosting mode:', error);
        // On error, assume self-hosted to avoid blocking users
        setIsSelfHosted(true);
        setHasSubscription(true);
        setIsChecking(false);
        return;
      }

      // Check if current route is allowed without subscription
      const isAllowedRoute = ALLOWED_ROUTES_WITHOUT_SUBSCRIPTION.some(
        route => pathname.startsWith(route)
      );

      if (isAllowedRoute) {
        setIsChecking(false);
        return;
      }

      // Cloud mode: Check subscription status
      try {
        const response = await fetch('/api/billing/current');
        if (response.ok) {
          const data = await response.json();
          // Check if subscription is actually active (not just that endpoint returned OK)
          const isActive = data.subscription?.status === 'active' && data.subscription?.plan;
          if (isActive) {
            setHasSubscription(true);
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
        setIsChecking(false);
      }
    };

    checkHostingModeAndSubscription();
  }, [pathname, router]);

  // Self-hosted mode or allowed route: render children immediately
  if (isSelfHosted || ALLOWED_ROUTES_WITHOUT_SUBSCRIPTION.some(route => pathname.startsWith(route))) {
    return <>{children}</>;
  }

  // Still checking subscription - only shown in cloud mode, never in self-hosted
  if (isChecking && !isSelfHosted) {
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
