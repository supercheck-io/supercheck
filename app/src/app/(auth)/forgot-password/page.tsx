"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthBackLink, AuthCallout, AuthCard, AuthHeader, AuthLegal } from "@/components/auth/auth-shell";
import { Loader2 } from "lucide-react";
import { requestPasswordReset } from "@/utils/auth-client";
import { TurnstileCaptcha } from "@/components/auth/turnstile-captcha";
import { useCaptcha } from "@/hooks/use-captcha";
import { useAppConfig } from "@/hooks/use-app-config";
import {
  FieldGroup,
  Field,
  FieldLabel,
} from "@/components/ui/field";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const { isCloudHosted, isFetched, error: configError } = useAppConfig();
  const shouldShowLegalFooter = isFetched && !configError && isCloudHosted;

  // CAPTCHA state management
  const {
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
      // Turnstile tokens are single-use and expire after minutes: request a fresh
      // one for every submit instead of resending the one cached at page load.
      const freshToken = await captchaRef.current?.execute();
      const result = await requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
        fetchOptions: {
          headers: freshToken ? { "x-captcha-response": freshToken } : {},
        },
      });

      if (result.error) {
        // Only a real rate-limit response means "too many attempts"; a rejected
        // CAPTCHA says nothing about how often the user tried.
        const message = result.error.message?.toLowerCase() ?? "";
        if (result.error.status === 429 || message.includes("too many")) {
          setError(
            "Too many password reset attempts. Please try again after some time."
          );
        } else if (message.includes("captcha")) {
          setError("Verification failed. Please try again.");
        } else {
          setError("Could not send the reset link. Please try again.");
        }
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

  const legal = shouldShowLegalFooter ? <AuthLegal /> : undefined;

  if (isSuccess) {
    return (
      <AuthCard data-testid="forgot-password-success" footer={legal}>
        <FieldGroup>
          <AuthHeader
            status="info"
            title="Check your email"
            description={
              <>
                We&apos;ve sent a password reset link to{" "}
                <span className="font-medium text-foreground">{email}</span>. The link expires in 1 hour.
              </>
            }
          />

          <p className="text-center text-sm text-muted-foreground">
            Didn&apos;t receive the email? Check your spam folder or{" "}
            <button
              type="button"
              onClick={() => {
                setIsSuccess(false);
                setEmail("");
                resetCaptcha();
              }}
              className="rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              try again
            </button>
            .
          </p>

          <AuthBackLink href="/sign-in" />
        </FieldGroup>
      </AuthCard>
    );
  }

  return (
    <AuthCard data-testid="forgot-password-form" footer={legal}>
      <form method="post" onSubmit={handleSubmit} data-testid="forgot-password-form-element">
        <FieldGroup>
          <AuthHeader
            title="Forgot password"
            description="Enter your email address and we'll send you a link to reset your password."
          />

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

          {error && (
            <AuthCallout variant="error" data-testid="forgot-password-error">
              {error}
            </AuthCallout>
          )}

          {captchaError && <AuthCallout variant="error">{captchaError}</AuthCallout>}

          <Field>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={isLoading || !email}
              data-testid="forgot-password-submit"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send reset link
            </Button>
          </Field>

          <AuthBackLink href="/sign-in" data-testid="back-to-signin-link" />
        </FieldGroup>
      </form>

      {/* Invisible CAPTCHA - placed outside form to avoid any layout shift */}
      <TurnstileCaptcha
        ref={captchaRef}
        onSuccess={handleCaptchaSuccess}
        onError={handleCaptchaError}
        onExpire={handleCaptchaExpire}
      />
    </AuthCard>
  );
}
