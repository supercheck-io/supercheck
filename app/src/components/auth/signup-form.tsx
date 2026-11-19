"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { AuthCard, AuthCallout, PasswordToggle, AuthHeader, AuthLegal, AuthLoading, InviteBanner } from "./auth-shell";
import Link from "next/link";
import { useState, useEffect, type RefObject } from "react";
import { TurnstileCaptcha, type TurnstileCaptchaRef } from "./turnstile-captcha";
import { useCaptcha } from "@/hooks/use-captcha";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2 } from "lucide-react";
import { FieldGroup, Field, FieldLabel } from "@/components/ui/field";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { signupFormSchema, type SignupFormData } from "@/lib/validations/auth";

interface InviteData {
  organizationName: string;
  role: string;
  email?: string;
}

interface SignupFormProps {
  className?: string;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  inviteData: InviteData | null;
  inviteToken: string | null;
  /** Callback when CAPTCHA token changes (null when expired/failed) */
  onCaptchaToken?: (token: string | null) => void;
  /** Ref to pass to the TurnstileCaptcha for on-demand token execution */
  captchaRef?: RefObject<TurnstileCaptchaRef | null>;
  /** Whether the app is running in self-hosted mode (open registration) */
  isSelfHosted?: boolean;
  /** Whether legal footer links should be shown (cloud mode only, after config resolves) */
  shouldShowLegalFooter?: boolean;
  /** Whether new signups are enabled (default: true) */
  isSignupEnabled?: boolean;
  /** List of allowed email domains for registration (empty = all allowed) */
  allowedEmailDomains?: string[];
}

/**
 * SignupForm Component
 * 
 * Two modes:
 * - Invitation mode (cloud/with invite token): Email locked to invited address, invitation messaging
 * - Open registration (self-hosted without invite): All fields editable, standard signup form
 */
export function SignupForm({
  className,
  onSubmit,
  isLoading,
  error,
  inviteData,
  inviteToken,
  onCaptchaToken,
  captchaRef: externalCaptchaRef,
  isSelfHosted = false,
  shouldShowLegalFooter = false,
  isSignupEnabled = true,
  allowedEmailDomains = [],
}: SignupFormProps) {
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

  const form = useForm<SignupFormData>({
    resolver: zodResolver(signupFormSchema),
    defaultValues: {
      name: "",
      email: inviteData?.email || "",
      password: "",
    },
    mode: "onBlur",
  });

  // Update email field when inviteData changes
  useEffect(() => {
    if (inviteData?.email) {
      form.setValue("email", inviteData.email, { shouldValidate: true });
    }
  }, [inviteData, form]);

  const passwordValue = form.watch("password");

  // Determine mode: invitation flow vs open registration (self-hosted without invite)
  const isInviteMode = !!inviteData;
  // The public invite endpoint withholds the email from anonymous viewers, so only
  // lock the field when the address is actually known. Otherwise the invitee must type it.
  const isEmailLocked = !!inviteData?.email;
  const isOpenRegistration = isSelfHosted && !inviteData && !inviteToken;
  const hasEmailDomainRestriction = allowedEmailDomains.length > 0;

  // If signup is disabled and there's no invite, show a closed registration message
  if (!isSignupEnabled && !inviteData && !inviteToken) {
    return (
      <AuthCard className={className}>
        <AuthHeader
          title="Registration closed"
          description="New account registration is currently disabled. Please contact your administrator for access."
          logoHref="/"
        />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-foreground underline underline-offset-4">
            Sign in instead
          </Link>
        </p>
      </AuthCard>
    );
  }

  // Show loading state while fetching invite data (when invite token is present but data hasn't loaded)
  if (!inviteData && !isOpenRegistration) {
    return <AuthLoading label="Loading invitation…" />;
  }

  return (
    <AuthCard className={className} footer={shouldShowLegalFooter ? <AuthLegal /> : undefined}>
      <Form {...form}>
        <form method="post" onSubmit={onSubmit}>
          <FieldGroup>
            <AuthHeader
              logoHref="/"
              title={isInviteMode ? `Join ${inviteData.organizationName}` : "Create your account"}
              description={
                isInviteMode
                  ? isEmailLocked
                    ? "Create an account to accept your invitation."
                    : "Create an account with the email address this invitation was sent to."
                  : "Sign up to get started with Supercheck"
              }
            />

            {isInviteMode && (
              <InviteBanner organizationName={inviteData.organizationName} role={inviteData.role} email={inviteData.email} />
            )}

            {isOpenRegistration && (
              <AuthCallout variant="info">
                <p className="font-medium">Joining an existing team?</p>
                <p className="text-muted-foreground">
                  Ask your admin for an invite to join their organization instead of creating a new one.
                </p>
              </AuthCallout>
            )}

            {/* Name Field */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <Field>
                    <FieldLabel htmlFor="name">Your name</FieldLabel>
                    <FormControl>
                      <Input
                        id="name"
                        placeholder="John Doe"
                        autoComplete="name"
                        autoFocus
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </Field>
                </FormItem>
              )}
            />

            {/* Email Field - Read-only when invited, editable for open registration */}
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
                        placeholder={isEmailLocked ? undefined : "m@example.com"}
                        autoComplete="email"
                        readOnly={isEmailLocked}
                        className={isEmailLocked ? "bg-muted/50" : ""}
                        data-testid="signup-email-input"
                        {...field}
                      />
                    </FormControl>
                    {hasEmailDomainRestriction && !isEmailLocked && (
                      <p className="text-xs text-muted-foreground">
                        Allowed domains: {allowedEmailDomains.join(", ")}
                      </p>
                    )}
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
                    <FieldLabel htmlFor="password">Create password</FieldLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="new-password"
                          className={passwordValue ? "pr-10" : ""}
                          {...field}
                        />
                        {passwordValue && <PasswordToggle shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />}
                      </div>
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Min 8 characters with uppercase, lowercase, and number.
                    </p>
                    <FormMessage />
                  </Field>
                </FormItem>
              )}
            />

            {/* Error Message */}
            {error && (
              <AuthCallout variant="error">{error}</AuthCallout>
            )}

            {/* CAPTCHA Error */}
            {captchaError && (
              <AuthCallout variant="error">{captchaError}</AuthCallout>
            )}

            {/* Submit Button */}
            <Field>
              <Button type="submit" size="lg" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isInviteMode ? "Create account & join" : "Create account"}
              </Button>
            </Field>


            {/* Link to sign-in for existing users */}
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                href={inviteToken ? `/sign-in?invite=${inviteToken}` : "/sign-in"}
                className="font-medium text-foreground underline underline-offset-4"
              >
                Sign in instead
              </Link>
            </p>
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

