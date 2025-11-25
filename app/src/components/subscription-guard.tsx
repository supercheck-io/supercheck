"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";

// Check if we're in cloud mode (not self-hosted)
const isCloudMode = process.env.NEXT_PUBLIC_SELF_HOSTED !== 'true';

// Routes that don't require subscription
const ALLOWED_ROUTES_WITHOUT_SUBSCRIPTION = [
  '/billing',
  '/subscribe',
  '/settings',
  '/sign-out',
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

  useEffect(() => {
    // Self-hosted mode: skip subscription check
    if (!isCloudMode) {
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

    // Check subscription status
    const checkSubscription = async () => {
      try {
        const response = await fetch('/api/billing/current');
        if (response.ok) {
          setHasSubscription(true);
        } else {
          // No subscription - redirect to subscribe page
          console.log('No active subscription, redirecting to subscribe');
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

    checkSubscription();
  }, [pathname, router]);

  // Self-hosted mode or allowed route: render children immediately
  if (!isCloudMode || ALLOWED_ROUTES_WITHOUT_SUBSCRIPTION.some(route => pathname.startsWith(route))) {
    return <>{children}</>;
  }

  // Still checking subscription
  if (isChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Verifying subscription...</h2>
            <p className="text-sm text-muted-foreground">Please wait</p>
          </div>
        </div>
      </div>
    );
  }

  // Has subscription: render children
  if (hasSubscription) {
    return <>{children}</>;
  }

  // Redirecting (should not render, but just in case)
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Redirecting to billing...</h2>
          <p className="text-sm text-muted-foreground">Subscription required</p>
        </div>
      </div>
    </div>
  );
}
