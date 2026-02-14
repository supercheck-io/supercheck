"use client";
import { signUp, signIn } from "@/utils/auth-client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { SignupForm } from "@/components/auth/signup-form";
import { useAppConfig } from "@/hooks/use-app-config";
import { Loader2 } from "lucide-react";

interface InviteData {
  organizationName: string;
  role: string;
  email?: string;
}

/**
 * Sign-Up Page - INVITATION ONLY
 * 
 * This page is only for users who have been invited to an organization.
 * New users without an invitation should use the sign-in page with social auth
 * (GitHub/Google), which automatically creates accounts.
 */
export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SignUpPageContent />
    </Suspense>
  );
}

function SignUpPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  // Use cached hosting mode from useAppConfig (React Query cached)
  const { isCloudHosted } = useAppConfig();
  // Store captcha token in ref since we need latest value in async handlers
  const captchaTokenRef = useRef<string | null>(null);

  // Derive invite token from URL params (not state)
  const inviteToken = useMemo(() => searchParams.get("invite"), [searchParams]);

  useEffect(() => {
    // REDIRECT: If no invite token, redirect to sign-in page
    // New users should use social auth (GitHub/Google) on sign-in page
    if (!inviteToken) {
      router.replace("/sign-in");
      return;
    }

    // Fetch invite data for valid tokens
    const fetchInviteData = async () => {
      try {
        const response = await fetch(`/api/invite/${inviteToken}`);
        const data = await response.json();
        if (data.success) {
          setInviteData(data.data);
        } else {
          // Invalid invite token, redirect to sign-in
          router.replace("/sign-in");
        }
      } catch (fetchError) {
        console.error("Error fetching invite data:", fetchError);
        router.replace("/sign-in");
      }
    };
    fetchInviteData();
    // Hosting mode comes from useAppConfig (cached)
  }, [inviteToken, router]);

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

    // Note: Disposable email check removed - social-only signup prevents throwaway emails
    // Email/password form is only shown for invitation flow where email is already trusted

    // Get CAPTCHA headers for auth requests
    const captchaHeaders: Record<string, string> = captchaTokenRef.current
      ? { "x-captcha-response": captchaTokenRef.current }
      : {};

    if (inviteToken) {
      captchaHeaders["x-invite-token"] = inviteToken;
    }

    const { error: signUpError } = await signUp.email({
      name,
      email,
      password,
      fetchOptions: {
        headers: captchaHeaders,
      },
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
              fetchOptions: {
                headers: captchaHeaders,
              },
            });
            if (!signInError) {
              // Auto-accept the invitation instead of redirecting to accept page
              try {
                const acceptResponse = await fetch(`/api/invite/${inviteToken}`, {
                  method: "POST",
                });
                const acceptResult = await acceptResponse.json();
                if (acceptResponse.ok && acceptResult.success) {
                  console.log(`✅ Auto-accepted invitation to ${acceptResult.data?.organizationName}`);
                  router.push("/");
                  return;
                }
              } catch (acceptError) {
                console.error("Error auto-accepting invitation:", acceptError);
              }
              // Fallback if auto-accept fails
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

      // For invitation flow with other email-related errors, also try to verify
      if (
        inviteToken &&
        (signUpError.message?.includes("verify") ||
          signUpError.message?.includes("email"))
      ) {
        // User was created but might need verification - try the same flow
        try {
          const verifyResponse = await fetch("/api/auth/verify-invited-user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: inviteToken, email }),
          });

          if (verifyResponse.ok) {
            const { error: signInError } = await signIn.email({
              email,
              password,
              fetchOptions: {
                headers: captchaHeaders,
              },
            });
            if (!signInError) {
              try {
                const acceptResponse = await fetch(`/api/invite/${inviteToken}`, {
                  method: "POST",
                });
                const acceptResult = await acceptResponse.json();
                if (acceptResponse.ok && acceptResult.success) {
                  console.log(`✅ Auto-accepted invitation to ${acceptResult.data?.organizationName}`);
                  router.push("/");
                  return;
                }
              } catch (acceptError) {
                console.error("Error auto-accepting invitation:", acceptError);
              }
              router.push(`/invite/${inviteToken}`);
              return;
            }
          }
        } catch (verifyError) {
          console.error("Error verifying invited user:", verifyError);
        }
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
    if (isCloudHosted && !inviteToken) {
      router.push(`/verify-email?email=${encodeURIComponent(email)}`);
      return;
    }

    // For invitation flow in cloud mode: mark email as verified and SIGN IN
    // signUp doesn't establish a session, we need to explicitly sign in
    if (isCloudHosted && inviteToken) {
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

      // CRITICAL: Sign in the user to establish session
      // Without this, setup-defaults and auto-accept will fail with 401
      const { error: signInError } = await signIn.email({
        email,
        password,
        fetchOptions: {
          headers: captchaHeaders,
        },
      });

      if (signInError) {
        console.error("Error signing in after signup:", signInError);
        // Fallback: redirect to sign-in page with invite token
        router.push(`/sign-in?invite=${inviteToken}`);
        setIsLoading(false);
        return;
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

    // If user signed up with an invite token, AUTO-ACCEPT the invitation
    // This eliminates the redundant step of showing the accept page again
    if (inviteToken) {
      try {
        const acceptResponse = await fetch(`/api/invite/${inviteToken}`, {
          method: "POST",
        });
        const acceptResult = await acceptResponse.json();

        if (acceptResponse.ok && acceptResult.success) {
          // Success - redirect directly to dashboard
          console.log(`✅ Auto-accepted invitation to ${acceptResult.data?.organizationName}`);
          router.push("/");
          return;
        } else {
          console.warn("Could not auto-accept invitation:", acceptResult.error);
        }
      } catch (error) {
        console.error("Error auto-accepting invitation:", error);
      }
      // Fallback to invite page if auto-accept fails
      router.push(`/invite/${inviteToken}`);
      setIsLoading(false);
      return;
    }

    // Check subscription for new user signup WITHOUT invitation
    // For cloud mode, verify subscription status
    // Note: isCloudHosted comes from useAppConfig (cached)
    if (isCloudHosted) {
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

    // Default: redirect to dashboard
    router.push("/");
    setIsLoading(false);
  };

  // Handler for CAPTCHA token updates
  const handleCaptchaToken = useCallback((token: string | null) => {
    captchaTokenRef.current = token;
  }, []);

  return (
    <SignupForm
      className="w-full max-w-sm px-4"
      onSubmit={handleSubmit}
      isLoading={isLoading}
      error={error}
      inviteData={inviteData}
      inviteToken={inviteToken}
      onCaptchaToken={handleCaptchaToken}
    />
  );
}
