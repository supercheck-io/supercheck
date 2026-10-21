"use client";

import { buildOAuthResumePath, isOAuthResumePath, sanitizeNextPath } from "@/lib/auth/safe-next-path";
import { clearProjectsCache } from "@/hooks/use-project-context";
import { announceProjectChange, reloadProjectContext } from "@/lib/project-navigation";
import { signIn } from "@/utils/auth-client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import type { TurnstileCaptchaRef } from "@/components/auth/turnstile-captcha";
import { Loader2 } from "lucide-react";
import { parseInviteToken } from "@/lib/validations/auth";

interface InviteData {
  organizationName: string;
  role: string;
  email?: string;
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SignInPageContent />
    </Suspense>
  );
}

function SignInPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [isFromNotification, setIsFromNotification] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const captchaRef = useRef<TurnstileCaptchaRef>(null);

  // Derive invite token from URL params (not state)
  const inviteToken = useMemo(() => parseInviteToken(searchParams.get("invite")), [searchParams]);
  // Allowlisted continuation (e.g. CLI device approval); never an arbitrary redirect.
  const nextPath = useMemo(
    // An MCP client's authorization request resumes after sign-in; otherwise only
    // the allowlisted `next` continuations apply.
    () => buildOAuthResumePath(searchParams) ?? sanitizeNextPath(searchParams.get("next")),
    [searchParams],
  );

  const getInviteSignInGuidance = useCallback((message?: string) => {
    const normalized = String(message ?? "").toLowerCase();

    if (normalized.includes("too many requests") || normalized.includes("rate limit")) {
      return "Too many sign-in attempts. Please wait a moment and try again, or use the invitation sign-up flow.";
    }

    if (
      normalized.includes("invalid") ||
      normalized.includes("password") ||
      normalized.includes("credential")
    ) {
      return "Could not sign in with these credentials. If you have not created your account yet, click \"Create one\" first.";
    }

    return "It looks like this invited account is not signed up yet. Please click \"Create one\" to sign up first.";
  }, []);

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
    const from = searchParams.get("from");
    const verified = searchParams.get("verified");

    // Defer fetchInviteData to avoid synchronous setState in effect body
    if (inviteToken) {
      setTimeout(() => fetchInviteData(inviteToken), 0);
    }

    // Defer state updates to avoid synchronous setState in effect body
    if (from === "notification") {
      setTimeout(() => setIsFromNotification(true), 0);
    }

    // Check if user just verified their email
    if (verified === "true") {
      setTimeout(() => {
        setEmailVerified(true);
        // Clean up the URL without refreshing the page
        const url = new URL(window.location.href);
        url.searchParams.delete("verified");
        window.history.replaceState({}, "", url.toString());
      }, 0);
    }
  }, [searchParams, inviteToken, fetchInviteData]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    const formData = new FormData(event.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    try {
      // Step 1: Check for lockout before attempting sign-in
      const lockoutCheck = await fetch("/api/auth/sign-in/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pre-check", email }),
      });
      const lockoutData = await lockoutCheck.json();

      if (lockoutData.isLocked) {
        setError(lockoutData.message || "Account temporarily locked. Please try again later.");
        setIsLoading(false);
        return;
      }

      // Step 2: Attempt sign-in via Better Auth
      // Include CAPTCHA token in request headers if available
      // Better Auth captcha plugin validates via x-captcha-response header
      // Turnstile tokens are single-use: request a fresh one for every attempt
      // (a retry after a wrong password would otherwise resend a spent token).
      // No stale-token fallback: a spent token only fails verification server-side.
      const freshToken = await captchaRef.current?.execute();
      const { error } = await signIn.email({
        email,
        password,
        fetchOptions: {
          headers: freshToken ? { "x-captcha-response": freshToken } : {},
        },
      });

      if (error) {
        // Classify CAPTCHA first: "Captcha verification failed" also contains
        // "verif" and must not be mistaken for the email-verification gate below.
        // A CAPTCHA rejection says nothing about the credentials: don't count it
        // toward lockout, and don't blame the invitee's account.
        const errorMessage = error.message?.toLowerCase() ?? "";
        if (errorMessage.includes("captcha")) {
          setError("Verification failed. Please try again.");
          return;
        }
        if (inviteToken && errorMessage.includes("verif")) {
          router.push(`/verify-email?email=${encodeURIComponent(email)}&invite=${encodeURIComponent(inviteToken)}`);
          return;
        }
        // Invitees receive guidance while server hooks enforce lockout.
        if (inviteToken) {
          setError(getInviteSignInGuidance(error.message));
          return;
        }

        // Keep pre-lockout errors generic. Exposing attempts remaining only for
        // known accounts enables account enumeration.
        setError(error.message || "An error occurred");
      } else {
        // If user signed in with an invite token, auto-accept the invitation
        if (inviteToken) {
          try {
            const acceptResponse = await fetch(`/api/invite/${inviteToken}`, {
              method: "POST",
            });
            const acceptResult = await acceptResponse.json();
            if (acceptResponse.ok && acceptResult.success) {
              console.log(`✅ Auto-accepted invitation to ${acceptResult.data?.organizationName}`);
              announceProjectChange();
              reloadProjectContext(clearProjectsCache);
              return;
            }
          } catch (acceptError) {
            console.error("Error auto-accepting invitation:", acceptError);
          }
          // Fallback: redirect to invite page for manual acceptance
          router.push(`/invite/${inviteToken}`);
        } else if (isOAuthResumePath(nextPath)) {
          // The authorize endpoint answers with a redirect, so leave the SPA router.
          window.location.assign(nextPath as string);
        } else {
          router.push(nextPath ?? "/");
        }
      }
    } catch (err) {
      console.error("Sign-in error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LoginForm
      className="w-full max-w-sm px-4"
      nextPath={nextPath}
      onSubmit={handleSubmit}
      isLoading={isLoading}
      error={error}
      inviteData={inviteData}
      inviteToken={inviteToken}
      isFromNotification={isFromNotification}
      emailVerified={emailVerified}
      captchaRef={captchaRef}
    />
  );
}
