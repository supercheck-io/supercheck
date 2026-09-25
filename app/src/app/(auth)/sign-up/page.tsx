"use client";
import { signUp, sendVerificationEmail } from "@/utils/auth-client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { SignupForm } from "@/components/auth/signup-form";
import { useAppConfig } from "@/hooks/use-app-config";
import { Loader2 } from "lucide-react";
import type { TurnstileCaptchaRef } from "@/components/auth/turnstile-captcha";

interface InviteData {
  organizationName: string;
  role: string;
  email?: string;
}

/**
 * Sign-Up Page
 * 
 * Cloud mode: INVITATION ONLY — new users without invitation use social auth on sign-in page.
 * Self-hosted mode: Open registration — anyone can create an account with email/password.
 * This allows self-hosted deployments behind corporate proxies to work without OAuth.
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
  const { isCloudHosted, isSelfHosted, isFetched, error: configError, isSignupEnabled, allowedEmailDomains } = useAppConfig();
  const shouldShowLegalFooter = isFetched && !configError && isCloudHosted;
  // CAPTCHA ref for on-demand token execution (each auth call needs a fresh token)
  const captchaRef = useRef<TurnstileCaptchaRef>(null);

  // Derive invite token from URL params (not state)
  const inviteToken = useMemo(() => searchParams.get("invite"), [searchParams]);

  useEffect(() => {
    // Apply hosting rules once config query resolves.
    // If config fetch fails, useAppConfig falls back to cloud-safe defaults.
    const canApplyHostingRules = isFetched;

    // Cloud mode: invitation-only sign-up. Redirect if no invite token.
    // Self-hosted mode: open registration, no invite token required.
    if (canApplyHostingRules && !inviteToken && isCloudHosted) {
      router.replace("/sign-in");
      return;
    }

    // Self-hosted: when signup is disabled and no invite token, redirect to sign-in
    if (canApplyHostingRules && !inviteToken && isSelfHosted && !isSignupEnabled) {
      router.replace("/sign-in");
      return;
    }

    // Fetch invite data for valid tokens
    if (inviteToken) {
      const fetchInviteData = async () => {
        try {
          const response = await fetch(`/api/invite/${inviteToken}`);
          const data = await response.json();
          if (data.success) {
            setInviteData(data.data);
          } else if (canApplyHostingRules && isCloudHosted) {
            // Invalid invite token in cloud mode, redirect to sign-in
            router.replace("/sign-in");
          } else if (canApplyHostingRules) {
            // Self-hosted mode: invalid invite should fall back to open sign-up
            router.replace("/sign-up");
          }
        } catch (fetchError) {
          console.error("Error fetching invite data:", fetchError);
          if (canApplyHostingRules && isCloudHosted) {
            router.replace("/sign-in");
          } else if (canApplyHostingRules) {
            // Self-hosted mode: invalid invite should fall back to open sign-up
            router.replace("/sign-up");
          }
        }
      };
      fetchInviteData();
    }
  }, [inviteToken, router, isCloudHosted, isSelfHosted, isSignupEnabled, isFetched, configError]);

  /**
   * Helper: get fresh CAPTCHA headers for a single auth API call.
   * Turnstile tokens are single-use, so we must execute a fresh challenge
   * before EACH call to a CAPTCHA-protected endpoint (signUp.email, signIn.email).
   */
  const getFreshCaptchaHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await captchaRef.current?.execute();
    const headers: Record<string, string> = token
      ? { "x-captcha-response": token }
      : {};
    if (inviteToken) {
      headers["x-invite-token"] = inviteToken;
    }
    return headers;
  }, [inviteToken]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    const formData = new FormData(event.currentTarget);
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    // Validate email matches invitation if present
    if (inviteData?.email && email !== inviteData.email) {
      setError("Email must match the invitation email address");
      setIsLoading(false);
      return;
    }

    // Get fresh CAPTCHA token for sign-up
    const signUpHeaders = await getFreshCaptchaHeaders();

    const { error: signUpError } = await signUp.email({
      name,
      email,
      password,
      callbackURL: inviteToken
        ? `/sign-in?verified=true&invite=${encodeURIComponent(inviteToken)}`
        : "/sign-in?verified=true",
      fetchOptions: {
        headers: signUpHeaders,
      },
    });

    if (signUpError) {
      // ── 1. User already exists ───────────────────────────────────────
      // Better Auth returns 422 for duplicate users. The error message
      // contains "already exists". For invited users, redirect to sign-in
      // with a clear message so they can use their existing credentials.
      if (
        signUpError.status === 422 ||
        signUpError.message?.toLowerCase().includes("already exist")
      ) {
        if (inviteToken) {
          // User already has an account — they should sign in instead
          router.push(`/sign-in?invite=${inviteToken}`);
          return;
        }
        setError("An account with this email already exists. Please sign in instead.");
        setIsLoading(false);
        return;
      }

      // ── 2. CAPTCHA verification failed ───────────────────────────────
      // CAPTCHA plugin returns 403 with message containing "aptcha".
      // This means the request was blocked before user creation.
      // Do NOT confuse with email verification 403.
      if (
        signUpError.message?.toLowerCase().includes("captcha") ||
        signUpError.message?.toLowerCase().includes("missing captcha")
      ) {
        setError("Verification failed. Please try again.");
        setIsLoading(false);
        return;
      }

      // Better Auth can create the account before returning the verification gate.
      if (isCloudHosted && inviteToken && signUpError.status === 403) {
        router.push(`/verify-email?email=${encodeURIComponent(email)}&invite=${encodeURIComponent(inviteToken)}`);
        return;
      }

      // ── 4. Non-invitation email verification (cloud mode only) ───────
      // Only redirect to verify-email in cloud mode where email verification
      // is required. Self-hosted mode has no email verification requirement.
      if (
        isCloudHosted &&
        (signUpError.message?.includes("verify") ||
        signUpError.status === 403)
      ) {
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }

      // ── 5. All other errors ──────────────────────────────────────────
      setError(signUpError.message || "An error occurred");
      setIsLoading(false);
      return;
    }

    // ════════════════════════════════════════════════════════════════════
    // Sign-up succeeded (200 OK).
    // Invited accounts must verify their email before joining in either hosting mode.
    // Other self-hosted sign-ups keep the existing open-registration flow.
    // ════════════════════════════════════════════════════════════════════

    if (inviteToken || isCloudHosted) {
      if (inviteToken && isSelfHosted) {
        const verification = await sendVerificationEmail({
          email,
          callbackURL: `/sign-in?verified=true&invite=${encodeURIComponent(inviteToken)}`,
        });
        if (verification.error) {
          setError("Account created, but the verification email could not be sent. Use the resend option on the verification page.");
        }
      }
      const inviteQuery = inviteToken ? `&invite=${encodeURIComponent(inviteToken)}` : "";
      router.push(`/verify-email?email=${encodeURIComponent(email)}${inviteQuery}`);
      return;
    }

    // Self-hosted mode: session is already established, proceed with setup
    await new Promise((resolve) => setTimeout(resolve, 500));

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

    // Default: redirect to dashboard
    router.push("/");
    setIsLoading(false);
  };

  // Handler for CAPTCHA token updates (not needed for on-demand execution,
  // but kept for the initial automatic challenge completion)
  const handleCaptchaToken = useCallback(() => {
    // Token management is now handled via captchaRef.execute()
    // No need to store it — each auth call gets a fresh token
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
      captchaRef={captchaRef}
      isSelfHosted={isSelfHosted}
      shouldShowLegalFooter={shouldShowLegalFooter}
      isSignupEnabled={isSignupEnabled}
      allowedEmailDomains={allowedEmailDomains}
    />
  );
}
