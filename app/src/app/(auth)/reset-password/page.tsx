"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthBackLink, AuthCallout, AuthCard, AuthHeader, AuthLegal, AuthLoading, PasswordToggle } from "@/components/auth/auth-shell";
import { Loader2 } from "lucide-react";
import { resetPassword } from "@/utils/auth-client";
import { useAppConfig } from "@/hooks/use-app-config";
import {
  FieldGroup,
  Field,
  FieldLabel,
} from "@/components/ui/field";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <ResetPasswordPageContent />
    </Suspense>
  );
}

function ResetPasswordPageContent() {
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
  const { isCloudHosted, isFetched, error: configError } = useAppConfig();
  const shouldShowLegalFooter = isFetched && !configError && isCloudHosted;

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


  const legal = shouldShowLegalFooter ? <AuthLegal /> : undefined;

  // Loading state
  if (!token && !error) return <AuthLoading />;

  // Success state
  if (isSuccess) {
    return (
      <AuthCard footer={legal}>
        <FieldGroup>
          <AuthHeader
            status="success"
            title="Password reset"
            description="You can now sign in with your new password."
          />

          <div role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span>Redirecting to sign in…</span>
          </div>

          <Field>
            <Button size="lg" onClick={() => router.push("/sign-in")} className="w-full">
              Go to sign in
            </Button>
          </Field>
        </FieldGroup>
      </AuthCard>
    );
  }

  return (
    <AuthCard footer={legal}>
      <form method="post" onSubmit={handleSubmit}>
        <FieldGroup>
          <AuthHeader logoHref="/" title="Reset password" description="Enter your new password below." />

          <Field>
            <FieldLabel htmlFor="password">New password</FieldLabel>
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
              {password && <PasswordToggle shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />}
            </div>
            <p className="text-xs text-muted-foreground">
              Min 8 characters with uppercase, lowercase, and number.
            </p>
          </Field>

          <Field>
            <FieldLabel htmlFor="confirmPassword">Confirm new password</FieldLabel>
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
              {confirmPassword && <PasswordToggle shown={showConfirmPassword} onToggle={() => setShowConfirmPassword(!showConfirmPassword)} />}
            </div>
          </Field>


          {error && <AuthCallout variant="error">{error}</AuthCallout>}

          <Field>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={isLoading || !password || !confirmPassword || !token}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reset password
            </Button>
          </Field>

          <AuthBackLink href="/sign-in" />
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
