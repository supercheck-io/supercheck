"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckIcon } from "@/components/logo/supercheck-logo";
import { Loader2, ArrowLeft, CheckCircle } from "lucide-react";
import Link from "next/link";
import { forgetPassword } from "@/utils/auth-client";
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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const result = await forgetPassword({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (result.error) {
        setError(
          "Too many password reset attempts. Please try again after some time."
        );
      } else {
        setIsSuccess(true);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="flex flex-col gap-6 w-full max-w-sm px-4">
        <FieldGroup>
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-green-500/10">
              <CheckCircle className="size-6 text-green-500" />
            </div>
            <h1 className="text-xl font-bold">Check your email</h1>
            <FieldDescription className="text-center">
              We&apos;ve sent a password reset link to{" "}
              <strong className="text-foreground">{email}</strong>
            </FieldDescription>
            <p className="text-xs text-muted-foreground">
              The link will expire in 1 hour for security reasons.
            </p>
          </div>

          <FieldDescription className="text-center">
            Didn&apos;t receive the email?{" "}
            <button
              type="button"
              onClick={() => {
                setIsSuccess(false);
                setEmail("");
              }}
              className="underline underline-offset-4 hover:text-foreground"
            >
              Try again
            </button>
          </FieldDescription>

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

  return (
    <div className="flex flex-col gap-6 w-full max-w-sm px-4">
      <form onSubmit={handleSubmit}>
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
            />
          </Field>

          {/* Error Message */}
          {error && (
            <p className="text-sm font-medium text-destructive text-center">
              {error}
            </p>
          )}

          {/* Submit Button */}
          <Field>
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || !email}
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
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </Link>
          </div>
        </FieldGroup>
      </form>
    </div>
  );
}
