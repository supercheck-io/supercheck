"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "@/components/logo/supercheck-logo";
import { Loader2, Mail, CheckCircle, ArrowLeft, Clock } from "lucide-react";
import Link from "next/link";
import { sendVerificationEmail } from "@/utils/auth-client";
import { FieldGroup, Field, FieldDescription } from "@/components/ui/field";

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
  const searchParams = useSearchParams();
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
        callbackURL: "/",
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
  }, [email]);

  return (
    <div className="flex flex-col gap-6 w-full max-w-sm px-4">
      <FieldGroup>
        {/* Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          <Link
            href="/"
            className="flex flex-col items-center gap-3 font-medium"
          >
            <div className="flex size-14 items-center justify-center rounded-md">
              <CheckIcon className="size-12" />
            </div>
            <span className="sr-only">Supercheck</span>
          </Link>
        </div>

        {/* Email Icon */}
        <div className="flex justify-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
            <Mail className="size-8 text-primary" />
          </div>
        </div>

        {/* Content */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Check your email</h1>
          <FieldDescription>
            We&apos;ve sent a verification link to
          </FieldDescription>
          {email && <p className="font-medium text-foreground">{email}</p>}
          <FieldDescription>
            Click the link in the email to verify your account and complete
            signup.
          </FieldDescription>
        </div>

        {/* Success Message */}
        {resendSuccess && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-green-500/10 border border-green-500/20">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span className="text-sm text-green-600 dark:text-green-400">
              Verification email sent successfully!
            </span>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <p className="text-sm font-medium text-destructive text-center">
            {error}
          </p>
        )}

        {/* Resend Button */}
        <Field>
          <Button
            onClick={handleResendVerification}
            variant="outline"
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

        {/* Info */}
        <FieldDescription className="text-center text-xs">
          Didn&apos;t receive the email? Check your spam folder or click resend.
        </FieldDescription>

        {/* Back Link */}
        <div className="text-center">
          <Link
            href="/sign-in"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </div>
      </FieldGroup>
    </div>
  );
}
