"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ArrowRight, Loader2, RefreshCw } from "lucide-react";

const CHECKOUT_CONTEXT_MISMATCH_MESSAGE = "This checkout belongs to a different organization. Use the project selector to select a project in the checkout organization, then retry confirmation if needed.";

function BillingSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [countdown, setCountdown] = useState(3);
  const [isVerifying, setIsVerifying] = useState(true);
  const [subscriptionVerified, setSubscriptionVerified] = useState(false);
  const [showRetry, setShowRetry] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const attemptsRef = useRef(0);
  const pollingGeneration = useRef(0);

  const checkoutId = searchParams.get("checkout_id");
  const organizationId = searchParams.get("organization_id");
  const [navigationError, setNavigationError] = useState<string | null>(null);

  const goToOrganization = useCallback(async () => {
    try {
      // Recheck the current tenant without changing it. An old checkout link
      // must not select another organization or use its paid subscription.
      const response = await fetch("/api/subscription/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to confirm your subscription. Please try again.");
      const current = await response.json();
      if (organizationId && current.organizationId !== organizationId) {
        setSubscriptionVerified(false);
        setShowRetry(true);
        throw new Error(CHECKOUT_CONTEXT_MISMATCH_MESSAGE);
      }
      if (!current.isActive || (current.plan !== "plus" && current.plan !== "pro")) {
        throw new Error("Your subscription is still being confirmed. Please retry verification.");
      }
      router.push("/");
      router.refresh();
    } catch (error) {
      setSubscriptionVerified(false);
      setIsVerifying(false);
      setShowRetry(true);
      setNavigationError(error instanceof Error ? error.message : "Unable to open the organization");
    }
  }, [organizationId, router]);

  // Verify subscription is active before redirecting
  const verifySubscription = useCallback(async (): Promise<"active" | "pending" | "mismatch"> => {
    try {
      const response = await fetch("/api/subscription/status", {
        cache: "no-store",
      });
      if (response.ok) {
        const data = await response.json();
        if (organizationId && data.organizationId !== organizationId) {
          return "mismatch";
        }
        // Check if subscription is active
        if ((!organizationId || data.organizationId === organizationId) && data.isActive && (data.plan === "plus" || data.plan === "pro")) {
          return "active";
        }
      }
      return "pending";
    } catch {
      return "pending";
    }
  }, [organizationId]);

  const stopPolling = useCallback(() => {
    pollingGeneration.current++;
    if (pollingRef.current) clearTimeout(pollingRef.current);
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    const generation = pollingGeneration.current;
    setIsVerifying(true);
    setShowRetry(false);
    setSubscriptionVerified(false);
    setCountdown(3);
    setNavigationError(null);
    attemptsRef.current = 0;

    const pollSubscription = async () => {
      const verified = await verifySubscription();
      if (generation !== pollingGeneration.current) return;
      if (verified === "mismatch") {
        stopPolling();
        setNavigationError(CHECKOUT_CONTEXT_MISMATCH_MESSAGE);
        setSubscriptionVerified(false);
        setIsVerifying(false);
        setShowRetry(true);
        return;
      }
      if (verified === "active") {
        setSubscriptionVerified(true);
        setIsVerifying(false);
        setShowRetry(false);
        return;
      }

      attemptsRef.current++;
      // Poll for up to 30 seconds (webhooks can be slow sometimes)
      if (attemptsRef.current < 30) {
        // Poll every second
        pollingRef.current = setTimeout(pollSubscription, 1000);
      } else {
        // Bound automatic polling; users can retry delayed webhook confirmation.
        setShowRetry(true);
        setIsVerifying(false);
      }
    };

    pollSubscription();
  }, [verifySubscription, stopPolling]);

  // Start polling on mount - wrapped in setTimeout to avoid synchronous setState warning
  useEffect(() => {
    // Use setTimeout to defer the initial call, avoiding synchronous setState in effect
    const timeoutId = setTimeout(() => {
      startPolling();
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  useEffect(() => {
    // Only start countdown after subscription is verified
    if (!subscriptionVerified) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          // Use setTimeout to avoid calling router.push during render
          setTimeout(() => void goToOrganization(), 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [goToOrganization, subscriptionVerified]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <Card className="max-w-md w-full text-center">
        <CardHeader className="space-y-4">
          <div className="mx-auto w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center">
            {isVerifying ? (
              <Loader2 className="w-10 h-10 text-green-500 animate-spin" />
            ) : subscriptionVerified ? (
              <CheckCircle2 className="w-10 h-10 text-green-500" />
            ) : <RefreshCw className="w-10 h-10 text-muted-foreground" />}
          </div>
          <CardTitle className="text-2xl">
            {isVerifying
              ? "Activating Subscription..."
              : subscriptionVerified ? "Subscription Activated!" : "Confirmation Needed"}
          </CardTitle>
          <CardDescription className="text-base">
            {isVerifying
              ? "Please wait while we confirm your account. This usually takes just a few seconds."
              : subscriptionVerified ? "Thank you! Your subscription is active and your plan is ready to use." : "Choose a project in the checkout organization or retry verification."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
            <p>
              {isVerifying
                ? "We're confirming your account setup. This may take a moment..."
                : subscriptionVerified ? "You can review your subscription and invoices in Manage subscription." : "Your current project and the checkout must belong to the same organization."}
            </p>
          </div>

          <div className="space-y-3">
            {showRetry ? (
              <>
                <Button
                  className="w-full"
                  size="lg"
                  variant="outline"
                  onClick={() => startPolling()}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry Verification
                </Button>
                <p className="text-sm text-muted-foreground">
                  Automatic verification has paused. Select the correct project or retry when the subscription is ready.
                </p>
                <Button className="w-full" variant="ghost" onClick={() => router.push("/")}>Return to projects</Button>
              </>
            ) : (
              <>
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => void goToOrganization()}
                  disabled={isVerifying}
                >
                  {isVerifying ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Confirming...
                    </>
                  ) : (
                    <>
                      Go to Dashboard
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>

                <p className="text-sm text-muted-foreground">
                  {isVerifying
                    ? "Confirming account setup..."
                    : navigationError ? "Use Go to Dashboard to try again." : `Redirecting automatically in ${countdown} seconds...`}
                </p>
              </>
            )}
          </div>

          {navigationError && <p role="alert" className="text-sm text-destructive">{navigationError}</p>}

          {checkoutId && (
            <p className="text-xs text-muted-foreground">
              Checkout ID: {checkoutId}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function BillingSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh] p-8">
          <Card className="max-w-md w-full text-center">
            <CardHeader className="space-y-4">
              <div className="mx-auto w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-green-500 animate-spin" />
              </div>
              <CardTitle className="text-2xl">Loading...</CardTitle>
            </CardHeader>
          </Card>
        </div>
      }
    >
      <BillingSuccessContent />
    </Suspense>
  );
}
