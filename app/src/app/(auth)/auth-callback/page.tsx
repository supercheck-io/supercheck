"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/utils/auth-client";
import { Loader2 } from "lucide-react";

/**
 * OAuth Callback Handler
 *
 * This page handles the redirect after successful OAuth authentication.
 * It checks if the user is new and creates default organization/project if needed.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = useSession();
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const setupUser = async () => {
      // Wait for session to load
      if (isPending) return;

      // If no session, redirect to sign-in
      if (!session) {
        console.log("No session found, redirecting to sign-in");
        router.push("/sign-in");
        return;
      }

      try {
        setIsSettingUp(true);

        // Check if there's an invite token in the URL
        const inviteToken = searchParams.get("invite");
        const callbackUrl = searchParams.get("callbackUrl") || "/";

        // Try to set up defaults (organization and project)
        // The endpoint will check if user already has an org and skip if so
        const setupResponse = await fetch("/api/auth/setup-defaults", {
          method: "POST",
        });

        if (!setupResponse.ok) {
          console.warn("Setup defaults failed, but user is authenticated");
        }

        // Small delay to ensure database consistency
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Check hosting mode from server (runtime env var, not build-time)
        let isCloudMode = false;
        try {
          const modeResponse = await fetch("/api/config/hosting-mode");
          if (modeResponse.ok) {
            const modeData = await modeResponse.json();
            isCloudMode = modeData.cloudHosted;
          }
        } catch {
          // On error, assume self-hosted to avoid blocking users
          console.log("Could not check hosting mode, assuming self-hosted");
        }

        // For cloud mode: check if user needs to subscribe
        if (isCloudMode) {
          try {
            const billingResponse = await fetch("/api/billing/current");
            if (billingResponse.ok) {
              const billingData = await billingResponse.json();
              // Check if subscription is actually active (not just that the endpoint returned OK)
              if (billingData.subscription?.status !== "active" || !billingData.subscription?.plan) {
                console.log("Cloud mode: No active subscription, redirecting to subscribe");
                router.push("/subscribe?setup=true");
                return;
              }
            } else {
              // API error - redirect to subscribe to be safe
              console.log("Cloud mode: Billing check failed, redirecting to subscribe");
              router.push("/subscribe?setup=true");
              return;
            }
          } catch {
            console.log("Cloud mode: Could not verify subscription, redirecting to subscribe");
            router.push("/subscribe?setup=true");
            return;
          }
        }

        // Redirect to invite or callback URL
        if (inviteToken) {
          router.push(`/invite/${inviteToken}`);
        } else {
          router.push(callbackUrl);
        }
      } catch (err) {
        console.error("Error setting up user:", err);
        setError("Setup failed, but you are signed in. Redirecting...");

        // Still redirect even on error
        setTimeout(() => {
          const callbackUrl = searchParams.get("callbackUrl") || "/";
          router.push(callbackUrl);
        }, 2000);
      } finally {
        setIsSettingUp(false);
      }
    };

    setupUser();
  }, [session, isPending, router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">
            Setting up your account...
          </h2>
          <p className="text-sm text-muted-foreground">
            {error || "Please wait while we set up your workspace"}
          </p>
        </div>
      </div>
    </div>
  );
}
