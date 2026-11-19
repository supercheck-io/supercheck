"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { AuthCard, AuthCallout, PasswordToggle, AuthHeader, AuthLegal, InviteBanner } from "./auth-shell";
import Link from "next/link";
import { useEffect, useState, type RefObject } from "react";
import { SocialAuthButtons } from "./social-auth-buttons";
import { TurnstileCaptcha, type TurnstileCaptchaRef } from "./turnstile-captcha";
import { useCaptcha } from "@/hooks/use-captcha";
import { useAppConfig } from "@/hooks/use-app-config";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  FieldGroup,
  Field,
  FieldLabel,
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
import { isOAuthResumePath } from "@/lib/auth/safe-next-path";

/** The sign-up link keeps whichever continuation the visitor arrived with. */
function signUpHref(nextPath: string | null): string {
  if (!nextPath) return "/sign-up";
  // An MCP authorization request travels as its own signed query, which the sign-up page re-reads.
  if (isOAuthResumePath(nextPath)) return `/sign-up?${nextPath.slice(nextPath.indexOf("?") + 1)}`;
  return `/sign-up?next=${encodeURIComponent(nextPath)}`;
}

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
  /** Sanitized local continuation path (already allowlisted by the page). */
  nextPath?: string | null;
  /** Callback when CAPTCHA token changes (null when expired/failed) */
  onCaptchaToken?: (token: string | null) => void;
  /** Ref to the TurnstileCaptcha so the page can request a fresh single-use token per attempt */
  captchaRef?: RefObject<TurnstileCaptchaRef | null>;
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
  nextPath = null,
  onCaptchaToken,
  captchaRef: externalCaptchaRef,
}: LoginFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const {
    isSelfHosted,
    isCloudHosted,
    isGithubEnabled,
    isGoogleEnabled,
    isSignupEnabled,
    isFetched,
    error: configError,
  } = useAppConfig();
  const hasSocialAuth = isGithubEnabled || isGoogleEnabled;
  const shouldShowSocialAuth = (hasSocialAuth || !isFetched || !!configError);
  const shouldShowLegalFooter = isFetched && !configError && isCloudHosted;

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
    <AuthCard
      className={className}
      data-testid="login-form"
      footer={shouldShowLegalFooter ? <AuthLegal /> : undefined}
    >
      <Form {...form}>
        <form method="post" onSubmit={onSubmit} data-testid="login-form-element">
          <FieldGroup>
            <AuthHeader
              title={inviteData ? `Welcome to ${inviteData.organizationName}` : "Welcome to Supercheck"}
              description={
                inviteData ? (
                  <>
                    Sign in to accept your invitation.
                    <br />
                    Don&apos;t have an account?{" "}
                    <Link href={`/sign-up?invite=${inviteToken}`}>Create account</Link>
                  </>
                ) : isSelfHosted && isSignupEnabled ? (
                  <>
                    Don&apos;t have an account? <Link href={signUpHref(nextPath)}>Create account</Link>
                  </>
                ) : isSelfHosted && !isSignupEnabled ? (
                  "Contact your administrator for an account"
                ) : (
                  "New here? Sign in with GitHub or Google to get started"
                )
              }
            />

            {inviteData ? (
              <InviteBanner organizationName={inviteData.organizationName} role={inviteData.role} email={inviteData.email} />
            ) : null}

            {emailVerified && (
              <AuthCallout variant="success" data-testid="email-verified-alert">
                <p className="font-medium">Email verified</p>
                <p className="text-muted-foreground">You can now sign in to your account.</p>
              </AuthCallout>
            )}

            {/* Social Auth - shown when providers are available or config is unresolved, including on invitations */}
            {/* An invitee whose account uses social sign-in has no password. A different social email is refused at accept time */}
            {shouldShowSocialAuth && (
              <>
                <SocialAuthButtons
                  callbackUrl={inviteToken ? `/invite/${inviteToken}` : (nextPath ?? "/")}
                  disabled={isLoading}
                />

                {/* Separator */}
                <FieldSeparator>Or sign in with email</FieldSeparator>
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
                        {passwordValue && <PasswordToggle shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </Field>
                </FormItem>
              )}
            />

            {/* Error Message */}
            {error && (
              <AuthCallout variant="error" data-testid="login-error-message">
                {error}
              </AuthCallout>
            )}

            {/* CAPTCHA Error */}
            {captchaError && (
              <AuthCallout variant="error">{captchaError}</AuthCallout>
            )}

            {/* Submit Button */}
            <Field>
              <Button type="submit" size="lg" className="w-full" disabled={isLoading} data-testid="login-submit-button">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isLoading ? "Signing in…" : "Sign in"}
              </Button>
            </Field>

          </FieldGroup>
        </form>
      </Form>

      {/* Invisible CAPTCHA - placed outside form to avoid any layout shift */}
      <TurnstileCaptcha
        ref={externalCaptchaRef ?? captchaRef}
        onSuccess={handleCaptchaSuccess}
        onError={handleCaptchaError}
        onExpire={handleCaptchaExpire}
      />
    </AuthCard>
  );
}
