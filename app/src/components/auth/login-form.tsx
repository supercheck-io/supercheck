"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SupercheckLogo } from "@/components/logo/supercheck-logo";
import { Loader2, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SocialAuthButtons } from "./social-auth-buttons";
import { TurnstileCaptcha } from "./turnstile-captcha";
import { useCaptcha } from "@/hooks/use-captcha";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  FieldGroup,
  Field,
  FieldLabel,
  FieldDescription,
  FieldSeparator,
} from "@/components/ui/field";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { loginFormSchema, type LoginFormData } from "@/lib/validations/auth";

interface InviteData {
  organizationName: string;
  role: string;
  email?: string;
}

interface LoginFormProps {
  className?: string;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  inviteData: InviteData | null;
  inviteToken: string | null;
  isFromNotification?: boolean;
  emailVerified?: boolean;
  /** Callback when CAPTCHA token changes (null when expired/failed) */
  onCaptchaToken?: (token: string | null) => void;
}

export function LoginForm({
  className,
  onSubmit,
  isLoading,
  error,
  inviteData,
  inviteToken,
  isFromNotification = false,
  emailVerified = false,
  onCaptchaToken,
}: LoginFormProps) {
  const [showPassword, setShowPassword] = useState(false);

  // CAPTCHA state management
  const {
    captchaToken,
    captchaError,
    captchaRef,
    handleCaptchaSuccess,
    handleCaptchaError,
    handleCaptchaExpire,
  } = useCaptcha();

  // Notify parent when CAPTCHA token changes
  useEffect(() => {
    onCaptchaToken?.(captchaToken);
  }, [captchaToken, onCaptchaToken]);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      email: inviteData?.email || "",
      password: "",
    },
    mode: "onBlur",
  });

  // Update email field when inviteData changes
  useEffect(() => {
    if (inviteData?.email) {
      form.setValue("email", inviteData.email);
    }
  }, [inviteData, form]);

  const passwordValue = form.watch("password");

  return (
    <div className={cn("flex flex-col gap-6", className)} data-testid="login-form">
      <Form {...form}>
        <form onSubmit={onSubmit} data-testid="login-form-element">
          <FieldGroup>
            {/* Header */}
            <div className="flex flex-col items-center gap-3 text-center">

              <div className="flex size-14 items-center justify-center rounded-md">
                <SupercheckLogo className="size-12" />
              </div>
              <span className="sr-only">Supercheck</span>

              <h1 className="text-2xl font-bold">
                {inviteData
                  ? `Welcome to ${inviteData.organizationName}`
                  : "Welcome to Supercheck"}
              </h1>
              <FieldDescription>
                {inviteData ? (
                  <>
                    Sign in to join as{" "}
                    <span className="font-medium text-foreground">
                      {inviteData.role.replace(/_/g, " ")}
                    </span>
                    <br />
                    <span className="text-xs">
                      Don&apos;t have an account?{" "}
                      <Link
                        href={`/sign-up?invite=${inviteToken}`}
                        className="underline underline-offset-2"
                      >
                        Create one
                      </Link>
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    New here? Sign in with GitHub or Google to get started
                  </span>
                )}
              </FieldDescription>
            </div>

            {/* Email Verified Success Alert */}
            {emailVerified && (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20" data-testid="email-verified-alert">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/20">
                  <svg
                    className="h-4 w-4 text-green-600 dark:text-green-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-sm text-green-700 dark:text-green-300">
                    Email verified successfully!
                  </p>
                  <p className="text-xs text-green-600/80 dark:text-green-400/80">
                    Your email has been verified. You can now sign in to your
                    account.
                  </p>
                </div>
              </div>
            )}

            {/* Social Auth - Only show when NOT from an invitation */}
            {/* For invitations, user must sign in with the invited email address */}
            {!inviteData && (
              <>
                <SocialAuthButtons
                  callbackUrl={inviteToken ? `/invite/${inviteToken}` : "/"}
                  disabled={isLoading}
                />

                {/* Separator */}
                <FieldSeparator>Or sign in with email (invited members)</FieldSeparator>
              </>
            )}

            {/* Email Field */}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <Field>
                    <FieldLabel htmlFor="email">Email</FieldLabel>
                    <FormControl>
                      <Input
                        id="email"
                        type="email"
                        placeholder="m@example.com"
                        autoComplete="email"
                        readOnly={!!inviteData?.email}
                        data-testid="login-email-input"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </Field>
                </FormItem>
              )}
            />

            {/* Password Field */}
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <Field>
                    <div className="flex items-center justify-between">
                      <FieldLabel htmlFor="password">Password</FieldLabel>
                      <Link
                        href="/forgot-password"
                        className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
                        data-testid="login-forgot-password-link"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <FormControl>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          className={passwordValue ? "pr-10" : ""}
                          data-testid="login-password-input"
                          {...field}
                        />
                        {passwordValue && (
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            aria-label={
                              showPassword ? "Hide password" : "Show password"
                            }
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </Field>
                </FormItem>
              )}
            />

            {/* Error Message */}
            {error && (
              <p className="text-sm font-medium text-destructive text-center" data-testid="login-error-message" role="alert">
                {error}
              </p>
            )}

            {/* CAPTCHA Error */}
            {captchaError && (
              <p className="text-sm font-medium text-destructive text-center">
                {captchaError}
              </p>
            )}

            {/* Invisible CAPTCHA - auto-verifies users */}
            <TurnstileCaptcha
              ref={captchaRef}
              onSuccess={handleCaptchaSuccess}
              onError={handleCaptchaError}
              onExpire={handleCaptchaExpire}
            />

            {/* Submit Button */}
            <Field>
              <Button type="submit" className="w-full" disabled={isLoading} data-testid="login-submit-button">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Login
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </Form>

      {/* Footer */}
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our{" "}
        <Link href="https://supercheck.io/terms">Terms of Service</Link> and{" "}
        <Link href="https://supercheck.io/privacy">Privacy Policy</Link>.
      </FieldDescription>
    </div>
  );
}
