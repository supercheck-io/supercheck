"use client";
import { signUp, signIn } from "@/utils/auth-client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, useMemo } from "react";
import { SignupForm } from "@/components/auth/signup-form";
import {
  isDisposableEmail,
  getDisposableEmailErrorMessage,
} from "@/lib/validations/disposable-email-domains";

interface InviteData {
  organizationName: string;
  role: string;
  email?: string;
}

export default function SignUpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [isCloudMode, setIsCloudMode] = useState<boolean | null>(null);

  // Derive invite token from URL params (not state)
  const inviteToken = useMemo(() => searchParams.get("invite"), [searchParams]);

  // Fetch invite data - defined before useEffect that uses it
  const fetchInviteData = useCallback(async (token: string) => {
    try {
      const response = await fetch(`/api/invite/${token}`);
      const data = await response.json();
      if (data.success) {
        setInviteData(data.data);
      }
    } catch (fetchError) {
      console.error("Error fetching invite data:", fetchError);
    }
  }, []);

  useEffect(() => {
    // Defer fetchInviteData to avoid synchronous setState in effect body
    if (inviteToken) {
      setTimeout(() => fetchInviteData(inviteToken), 0);
    }

    // Check hosting mode - fetch already returns a promise, so this is async
    fetch("/api/config/hosting-mode")
      .then((res) => res.json())
      .then((data) => setIsCloudMode(data.cloudHosted))
      .catch(() => setIsCloudMode(true)); // Default to cloud mode if check fails
  }, [inviteToken, fetchInviteData]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    const formData = new FormData(event.currentTarget);
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    // Validate email matches invitation if present
    if (inviteData && email !== inviteData.email) {
      setError("Email must match the invitation email address");
      setIsLoading(false);
      return;
    }

    // Only check disposable emails in cloud mode
    if (isCloudMode && isDisposableEmail(email)) {
      setError(getDisposableEmailErrorMessage());
      setIsLoading(false);
      return;
    }

    const { error: signUpError } = await signUp.email({
      name,
      email,
      password,
    });

    if (signUpError) {
      // Handle email verification required error gracefully
      // For invitation flow, the user was created but needs verification
      // We'll mark their email as verified since the invitation validates it
      if (inviteToken && signUpError.status === 403) {
        // User was created but blocked due to email verification
        // Call our API to verify the invited user and redirect to accept invitation
        try {
          const verifyResponse = await fetch("/api/auth/verify-invited-user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: inviteToken, email }),
          });

          if (verifyResponse.ok) {
            // Now sign in the user and redirect to invitation acceptance
            const { error: signInError } = await signIn.email({
              email,
              password,
            });
            if (!signInError) {
              router.push(`/invite/${inviteToken}`);
              return;
            }
          }
        } catch (verifyError) {
          console.error("Error verifying invited user:", verifyError);
        }
        // If verification fails, redirect to sign-in to try again
        router.push(`/sign-in?invite=${inviteToken}`);
        return;
      }

      // For non-invitation flow, redirect to email verification page
      if (
        signUpError.message?.includes("verify") ||
        signUpError.message?.includes("email") ||
        signUpError.status === 403
      ) {
        // User created but needs to verify email - redirect to verification page
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }

      setError(signUpError.message || "An error occurred");
      setIsLoading(false);
      return;
    }

    // In cloud mode with email verification enabled, redirect to verify-email page
    // The user needs to verify their email before they can proceed
    // EXCEPTION: For invitation flow, skip email verification since the email is already verified
    // by the invitation system (the invite was sent to that specific email)
    if (isCloudMode && !inviteToken) {
      router.push(`/verify-email?email=${encodeURIComponent(email)}`);
      return;
    }

    // For invitation flow in cloud mode: mark email as verified
    if (isCloudMode && inviteToken) {
      try {
        const verifyResponse = await fetch("/api/auth/verify-invited-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: inviteToken, email }),
        });

        if (!verifyResponse.ok) {
          console.warn("Could not auto-verify email for invited user");
        }
      } catch (verifyError) {
        console.error("Error verifying invited user:", verifyError);
      }
    }

    // Self-hosted mode or invitation flow: no email verification required, proceed with setup
    // Wait a moment for the session to be established
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Call setup-defaults endpoint to create default org/project
    try {
      const response = await fetch("/api/auth/setup-defaults", {
        method: "POST",
      });

      if (response.ok) {
        await response.json();
      } else {
        console.warn("⚠️ Could not create defaults, but signup successful");
      }
    } catch (setupError) {
      console.warn(
        "⚠️ Setup defaults failed, but signup successful:",
        setupError
      );
    }

    // If user signed up with an invite token, redirect to accept invitation
    // Skip subscription check - invited members join the existing org's subscription
    if (inviteToken) {
      router.push(`/invite/${inviteToken}`);
      setIsLoading(false);
      return;
    }

    // Check hosting mode - only verify subscription for cloud mode
    // Note: This check is for new user signup WITHOUT invitation
    // Invited members skip this check entirely (handled above)
    try {
      const modeResponse = await fetch("/api/config/hosting-mode");
      if (modeResponse.ok) {
        const modeData = await modeResponse.json();

        // Only check subscription in cloud mode
        if (modeData.cloudHosted) {
          try {
            const billingResponse = await fetch("/api/billing/current");
            if (billingResponse.ok) {
              const billingData = await billingResponse.json();
              // Check if subscription is actually active
              if (
                billingData.subscription?.status !== "active" ||
                !billingData.subscription?.plan
              ) {
                console.log(
                  "Cloud mode: No active subscription, redirecting to subscribe"
                );
                router.push("/subscribe?setup=true");
                setIsLoading(false);
                return;
              }
            } else {
              // Billing check failed - redirect to subscribe to be safe
              router.push("/subscribe?setup=true");
              setIsLoading(false);
              return;
            }
          } catch {
            console.log(
              "Cloud mode: Failed to check subscription, redirecting to subscribe"
            );
            router.push("/subscribe?setup=true");
            setIsLoading(false);
            return;
          }
        }
        // Self-hosted mode: no subscription check needed, proceed to dashboard
      }
    } catch {
      console.log("Could not check hosting mode, proceeding to dashboard");
    }

    // Default: redirect to dashboard
    router.push("/");
    setIsLoading(false);
  };

  return (
    <SignupForm
      className="w-full max-w-sm px-4"
      onSubmit={handleSubmit}
      isLoading={isLoading}
      error={error}
      inviteData={inviteData}
      inviteToken={inviteToken}
    />
  );
}
