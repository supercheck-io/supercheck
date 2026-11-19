"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Clock } from "lucide-react";
import { useAppConfig } from "@/hooks/use-app-config";
import { AuthBackLink, AuthCallout, AuthCard, AuthHeader, AuthLegal, AuthLoading } from "@/components/auth/auth-shell";
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons";
import { sendVerificationEmail } from "@/utils/auth-client";
import { FieldGroup, Field, FieldSeparator } from "@/components/ui/field";
import { parseInviteToken } from "@/lib/validations/auth";

// Rate limiting configuration
const RESEND_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
const STORAGE_KEY_PREFIX = "verification_email_sent_";

function getStorageKey(email: string): string {
  return `${STORAGE_KEY_PREFIX}${btoa(email)}`;
}

function getLastSentTime(email: string): number | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(getStorageKey(email));
  return stored ? parseInt(stored, 10) : null;
}

function setLastSentTime(email: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(getStorageKey(email), Date.now().toString());
}

function getRemainingCooldown(email: string): number {
  const lastSent = getLastSentTime(email);
  if (!lastSent) return 0;
  const elapsed = Date.now() - lastSent;
  const remaining = RESEND_COOLDOWN_MS - elapsed;
  return remaining > 0 ? remaining : 0;
}

function formatCooldownTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (minutes > 0) {
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${seconds}s`;
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <VerifyEmailPageContent />
    </Suspense>
  );
}

function VerifyEmailPageContent() {
  const { isCloudHosted, isFetched, error: configError } = useAppConfig();
  const legal = isFetched && !configError && isCloudHosted ? <AuthLegal /> : undefined;
  const searchParams = useSearchParams();
  const inviteToken = parseInviteToken(searchParams.get("invite"));
  // Only a sign-up is answered with the existing-account email; a sign-in bounced here is not.
  const cameFromSignUp = searchParams.get("from") === "signup";
  const [email, setEmail] = useState("");
  const [isResending, setIsResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Initialize email from URL params and check cooldown
  useEffect(() => {
    const emailParam = searchParams.get("email");
    if (emailParam) {
      setEmail(emailParam);
      // Check if there's an existing cooldown
      const remaining = getRemainingCooldown(emailParam);
      setCooldownRemaining(remaining);
    }
  }, [searchParams]);

  // Countdown timer effect
  useEffect(() => {
    if (cooldownRemaining <= 0) return;

    const timer = setInterval(() => {
      setCooldownRemaining((prev) => {
        const newValue = prev - 1000;
        return newValue > 0 ? newValue : 0;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldownRemaining]);

  const handleResendVerification = useCallback(async () => {
    if (!email) return;

    // Check cooldown before sending
    const remaining = getRemainingCooldown(email);
    if (remaining > 0) {
      setCooldownRemaining(remaining);
      setError(
        `Please wait ${formatCooldownTime(remaining)} before requesting another email`
      );
      return;
    }

    setIsResending(true);
    setError(null);
    setResendSuccess(false);

    try {
      const result = await sendVerificationEmail({
        email,
        callbackURL: inviteToken
          ? `/sign-in?verified=true&invite=${encodeURIComponent(inviteToken)}`
          : "/sign-in?verified=true",
      });

      if (result.error) {
        setError(result.error.message || "Failed to resend verification email");
      } else {
        // Set cooldown timestamp on successful send
        setLastSentTime(email);
        setCooldownRemaining(RESEND_COOLDOWN_MS);
        setResendSuccess(true);
      }
    } catch {
      setError("Failed to resend verification email. Please try again.");
    } finally {
      setIsResending(false);
    }
  }, [email, inviteToken]);

  return (
    <AuthCard footer={legal}>
      <FieldGroup>
        <AuthHeader
          status="info"
          title="Check your email"
          description={
            <>
              We&apos;ve sent a verification link to{" "}
              {email ? <span className="font-medium text-foreground">{email}</span> : "your email address"}. Click the
              link to verify your account and complete signup.
            </>
          }
        />

        {inviteToken && cameFromSignUp && (
          <AuthCallout variant="info">
            If you already have an account, you&apos;ll also get an email shortly with a way to sign in.
          </AuthCallout>
        )}

        {resendSuccess && <AuthCallout variant="success" live>Verification email sent.</AuthCallout>}

        {error && <AuthCallout variant="error">{error}</AuthCallout>}

        <Field>
          <Button
            onClick={handleResendVerification}
            variant="outline"
            size="lg"
            className="w-full"
            disabled={isResending || !email || cooldownRemaining > 0}
          >
            {isResending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : cooldownRemaining > 0 ? (
              <>
                <Clock className="mr-2 h-4 w-4" />
                Resend in {formatCooldownTime(cooldownRemaining)}
              </>
            ) : (
              "Resend verification email"
            )}
          </Button>
        </Field>

        <p className="text-center text-xs text-muted-foreground">
          Didn&apos;t receive the email? Check your spam folder or click resend.
        </p>

        {inviteToken && (
          <>
            <FieldSeparator>Or continue with</FieldSeparator>
            <SocialAuthButtons callbackUrl={`/invite/${inviteToken}`} />
          </>
        )}

        <AuthBackLink
          href={inviteToken ? `/sign-in?invite=${encodeURIComponent(inviteToken)}` : "/sign-in"}
        >
          {inviteToken && cameFromSignUp ? "Already have an account? Sign in" : "Back to sign in"}
        </AuthBackLink>
      </FieldGroup>
    </AuthCard>
  );
}
