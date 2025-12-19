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

function BillingSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [countdown, setCountdown] = useState(3);
  const [isVerifying, setIsVerifying] = useState(true);
  const [subscriptionVerified, setSubscriptionVerified] = useState(false);
  const [showRetry, setShowRetry] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const attemptsRef = useRef(0);

  const checkoutId = searchParams.get("checkout_id");

  // Verify subscription is active before redirecting
  const verifySubscription = useCallback(async () => {
    try {
      const response = await fetch("/api/billing/current");
      if (response.ok) {
        const data = await response.json();
        // Check if subscription is active
        if (data.subscription?.status === "active" && data.subscription?.plan) {
          setSubscriptionVerified(true);
          setIsVerifying(false);
          setShowRetry(false);
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const startPolling = useCallback(() => {
    setIsVerifying(true);
    setShowRetry(false);
    attemptsRef.current = 0;

    const pollSubscription = async () => {
      const verified = await verifySubscription();
      if (verified) {
        return;
      }

      attemptsRef.current++;
      // Poll for up to 30 seconds (webhooks can be slow sometimes)
      if (attemptsRef.current < 30) {
        // Poll every second
        pollingRef.current = setTimeout(pollSubscription, 1000);
      } else {
        // After 30 attempts, show retry button but keep polling slowly
        setShowRetry(true);
        pollingRef.current = setTimeout(pollSubscription, 3000);
      }
    };

    pollSubscription();
  }, [verifySubscription]);

  // Start polling on mount - wrapped in setTimeout to avoid synchronous setState warning
  useEffect(() => {
    // Use setTimeout to defer the initial call, avoiding synchronous setState in effect
    const timeoutId = setTimeout(() => {
      startPolling();
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, [startPolling]);

  useEffect(() => {
    // Only start countdown after subscription is verified
    if (!subscriptionVerified) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          // Use setTimeout to avoid calling router.push during render
          setTimeout(() => router.push("/"), 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [router, subscriptionVerified]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <Card className="max-w-md w-full text-center">
        <CardHeader className="space-y-4">
          <div className="mx-auto w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center">
            {isVerifying ? (
              <Loader2 className="w-10 h-10 text-green-500 animate-spin" />
            ) : (
              <CheckCircle2 className="w-10 h-10 text-green-500" />
            )}
          </div>
          <CardTitle className="text-2xl">
            {isVerifying
              ? "Activating Subscription..."
              : "Subscription Activated!"}
          </CardTitle>
          <CardDescription className="text-base">
            {isVerifying
              ? "Please wait while we confirm your account. This usually takes just a few seconds."
              : "Thank you! Your account has been activated and you now have access to all features."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
            <p>
              {isVerifying
                ? "We're confirming your account setup. This may take a moment..."
                : "Your account is now active. A confirmation email has been sent to your registered email address."}
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
                  Taking longer than expected. Still checking in background...
                </p>
              </>
            ) : (
              <>
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => router.push("/")}
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
                    : `Redirecting automatically in ${countdown} seconds...`}
                </p>
              </>
            )}
          </div>

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
