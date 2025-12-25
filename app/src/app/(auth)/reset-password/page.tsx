"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckIcon } from "@/components/logo/supercheck-logo";
import { Loader2, Eye, EyeOff, CheckCircle } from "lucide-react";
import { resetPassword } from "@/utils/auth-client";
import Link from "next/link";
import {
  FieldGroup,
  Field,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const tokenParam = searchParams.get("token");
    if (!tokenParam) {
      setError(
        "Invalid or missing reset token. Please request a new password reset."
      );
      return;
    }
    setToken(tokenParam);
  }, [searchParams]);

  const validatePassword = (password: string): string | null => {
    if (password.length < 8) {
      return "Password must be at least 8 characters long";
    }
    if (!/(?=.*[a-z])/.test(password)) {
      return "Password must contain at least one lowercase letter";
    }
    if (!/(?=.*[A-Z])/.test(password)) {
      return "Password must contain at least one uppercase letter";
    }
    if (!/(?=.*\d)/.test(password)) {
      return "Password must contain at least one number";
    }
    return null;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError(
        "Invalid or missing reset token. Please request a new password reset."
      );
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setIsLoading(true);

    try {
      const result = await resetPassword({
        newPassword: password,
        token,
      });

      if (result.error) {
        setError(
          result.error.message ||
          "An error occurred while resetting your password"
        );
      } else {
        setIsSuccess(true);
        // Redirect to sign-in after 3 seconds
        setTimeout(() => {
          router.push("/sign-in");
        }, 3000);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state
  if (!token && !error) {
    return (
      <div className="flex flex-col gap-6 w-full max-w-sm px-4">
        <FieldGroup>
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-14 items-center justify-center rounded-md">
              <CheckIcon className="size-12" />
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading...</span>
            </div>
          </div>
        </FieldGroup>
      </div>
    );
  }

  // Success state
  if (isSuccess) {
    return (
      <div className="flex flex-col gap-6 w-full max-w-sm px-4">
        <FieldGroup>

          {/* Success Icon */}
          <div className="flex justify-center">
            <div className="flex size-20 items-center justify-center rounded-full bg-green-500/10">
              <CheckCircle className="size-10 text-green-500" />
            </div>
          </div>

          {/* Content */}
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold">Password reset successfully</h1>
            <FieldDescription>
              Your password has been successfully reset. You can now sign in
              with your new password.
            </FieldDescription>
          </div>

          {/* Redirect Message */}
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Redirecting to sign in...</span>
          </div>

          {/* Action Button */}
          <Field>
            <Button onClick={() => router.push("/sign-in")} className="w-full">
              Go to Sign In
            </Button>
          </Field>
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
            <h1 className="text-2xl font-bold">Reset password</h1>
            <FieldDescription>Enter your new password below.</FieldDescription>
          </div>

          {/* New Password Field */}
          <Field>
            <FieldLabel htmlFor="password">New Password</FieldLabel>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                className={password ? "pr-10" : ""}
                placeholder="Enter new password"
              />
              {password && (
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Min 8 characters with uppercase, lowercase, and number.
            </p>
          </Field>

          {/* Confirm Password Field */}
          <Field>
            <FieldLabel htmlFor="confirmPassword">
              Confirm New Password
            </FieldLabel>
            <div className="relative">
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className={confirmPassword ? "pr-10" : ""}
                placeholder="Confirm new password"
              />
              {confirmPassword && (
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={
                    showConfirmPassword ? "Hide password" : "Show password"
                  }
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
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
              disabled={isLoading || !password || !confirmPassword || !token}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reset password
            </Button>
          </Field>
        </FieldGroup>
      </form>

      {/* Footer */}
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our{" "}
        <Link href="https://supercheck.io/terms">Terms of Service</Link> and{" "}
        <Link href="https://supercheck.io/privacy">Privacy Policy</Link>.
      </FieldDescription>
    </div>
  );
}
