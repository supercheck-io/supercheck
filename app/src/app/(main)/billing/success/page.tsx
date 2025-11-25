"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ArrowRight } from "lucide-react";

export default function BillingSuccessPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [countdown, setCountdown] = useState(5);

  const checkoutId = searchParams.get("checkout_id");

  useEffect(() => {
    // Auto-redirect after 5 seconds
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
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <Card className="max-w-md w-full text-center">
        <CardHeader className="space-y-4">
          <div className="mx-auto w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-green-500" />
          </div>
          <CardTitle className="text-2xl">Subscription Activated!</CardTitle>
          <CardDescription className="text-base">
            Thank you for subscribing to Supercheck. Your account has been upgraded and you now have access to all features.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
            <p>Your subscription is now active. A confirmation email has been sent to your registered email address.</p>
          </div>

          <div className="space-y-3">
            <Button 
              className="w-full" 
              size="lg"
              onClick={() => router.push("/")}
            >
              Go to Dashboard
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            
            <p className="text-sm text-muted-foreground">
              Redirecting automatically in {countdown} seconds...
            </p>
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
