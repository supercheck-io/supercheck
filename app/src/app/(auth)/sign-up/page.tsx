"use client";
import { signUp } from "@/utils/auth-client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
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
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [isCloudMode, setIsCloudMode] = useState<boolean | null>(null);

  useEffect(() => {
    const invite = searchParams.get("invite");
    if (invite) {
      setInviteToken(invite);
      fetchInviteData(invite);
    }

    // Check hosting mode
    fetch("/api/config/hosting-mode")
      .then((res) => res.json())
      .then((data) => setIsCloudMode(data.cloudHosted))
      .catch(() => setIsCloudMode(true)); // Default to cloud mode if check fails
  }, [searchParams]);

  const fetchInviteData = async (token: string) => {
    try {
      const response = await fetch(`/api/invite/${token}`);
      const data = await response.json();
      if (data.success) {
        setInviteData(data.data);
      }
    } catch (fetchError) {
      console.error("Error fetching invite data:", fetchError);
    }
  };

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
    if (isCloudMode) {
      router.push(`/verify-email?email=${encodeURIComponent(email)}`);
      return;
    }

    // Self-hosted mode: no email verification required, proceed with setup
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
    if (inviteToken) {
      router.push(`/invite/${inviteToken}`);
      setIsLoading(false);
      return;
    }

    // Check hosting mode - only verify subscription for cloud mode
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
