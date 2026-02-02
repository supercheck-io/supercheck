"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckIcon } from "@/components/logo/supercheck-logo";
import { Loader2, ArrowLeft, Mail } from "lucide-react";
import Link from "next/link";
import { requestPasswordReset } from "@/utils/auth-client";
import { TurnstileCaptcha } from "@/components/auth/turnstile-captcha";
import { useCaptcha } from "@/hooks/use-captcha";
import {
  FieldGroup,
  Field,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  // CAPTCHA state management
  const {
    captchaToken,
    captchaError,
    captchaRef,
    handleCaptchaSuccess,
    handleCaptchaError,
    handleCaptchaExpire,
    resetCaptcha,
  } = useCaptcha();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // Include CAPTCHA token in request headers if available
      const result = await requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
        fetchOptions: {
          headers: captchaToken ? { "x-captcha-response": captchaToken } : {},
        },
      });

      if (result.error) {
        setError(
          "Too many password reset attempts. Please try again after some time."
        );
        resetCaptcha();
      } else {
        setIsSuccess(true);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
      resetCaptcha();
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="flex flex-col gap-6 w-full max-w-sm px-4" data-testid="forgot-password-success">
        <FieldGroup>
          {/* Email Icon - Primary visual element */}
          <div className="flex justify-center">
            <div className="flex size-20 items-center justify-center rounded-full bg-primary/10">
              <Mail className="size-10 text-primary" />
            </div>
          </div>

          {/* Content */}
          <div className="text-center space-y-3">
            <h1 className="text-2xl font-bold">Check your email</h1>
            <p className="text-base text-muted-foreground">
              We&apos;ve sent a password reset link to
            </p>
            <p className="text-lg font-semibold text-foreground">{email}</p>
            <p className="text-base text-muted-foreground">
              Click the link in the email to reset your password.
            </p>
            <p className="text-sm text-muted-foreground pt-2">
              The link will expire in 1 hour for security reasons.
            </p>
          </div>

          {/* Info */}
          <p className="text-sm text-muted-foreground text-center">
            Didn&apos;t receive the email? Check your spam folder or{" "}
            <button
              type="button"
              onClick={() => {
                setIsSuccess(false);
                setEmail("");
                resetCaptcha();
              }}
              className="underline underline-offset-4 hover:text-foreground"
            >
              try again
            </button>
            .
          </p>

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

        {/* Footer */}
        <FieldDescription className="px-6 text-center">
          By clicking continue, you agree to our{" "}
          <Link href="https://supercheck.io/terms">Terms of Service</Link> and{" "}
          <Link href="https://supercheck.io/privacy">Privacy Policy</Link>.
        </FieldDescription>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-sm px-4" data-testid="forgot-password-form">
      <form onSubmit={handleSubmit} data-testid="forgot-password-form-element">
        <FieldGroup>
          {/* Header */}
          <div className="flex flex-col items-center gap-3 text-center">

            <div className="flex size-14 items-center justify-center rounded-md">
              <CheckIcon className="size-12" />
            </div>
            <span className="sr-only">Supercheck</span>

            <h1 className="text-2xl font-bold">Forgot password</h1>
            <FieldDescription>
              Enter your email address and we&apos;ll send you a link to reset
              your password.
            </FieldDescription>
          </div>

          {/* Email Field */}
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="m@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              data-testid="forgot-password-email-input"
            />
          </Field>

          {/* Error Message */}
          {error && (
            <p className="text-sm font-medium text-destructive text-center" data-testid="forgot-password-error" role="alert">
              {error}
            </p>
          )}

          {/* CAPTCHA Error */}
          {captchaError && (
            <p className="text-sm font-medium text-destructive text-center">
              {captchaError}
            </p>
          )}

          {/* Submit Button */}
          <Field>
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || !email}
              data-testid="forgot-password-submit"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send reset link
            </Button>
          </Field>


          {/* Back Link */}
          <div className="text-center">
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              data-testid="back-to-signin-link"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </Link>
          </div>
        </FieldGroup>
      </form>

      {/* Footer */}
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our{" "}
        <Link href="https://supercheck.io/terms">Terms of Service</Link> and{" "}
        <Link href="https://supercheck.io/privacy">Privacy Policy</Link>.
      </FieldDescription>

      {/* Invisible CAPTCHA - placed outside form to avoid any layout shift */}
      <TurnstileCaptcha
        ref={captchaRef}
        onSuccess={handleCaptchaSuccess}
        onError={handleCaptchaError}
        onExpire={handleCaptchaExpire}
      />
    </div>
  );
}
