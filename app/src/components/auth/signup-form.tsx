"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SupercheckLogo } from "@/components/logo/supercheck-logo";
import { Loader2, Eye, EyeOff, Mail } from "lucide-react";
import Link from "next/link";
import { useState, useEffect, type RefObject } from "react";
import { TurnstileCaptcha, type TurnstileCaptchaRef } from "./turnstile-captcha";
import { useCaptcha } from "@/hooks/use-captcha";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2 } from "lucide-react";
import {
  FieldGroup,
  Field,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
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
      form.setValue("email", inviteData.email);
    }
  }, [inviteData, form]);

  const passwordValue = form.watch("password");

  // Determine mode: invitation flow vs open registration (self-hosted without invite)
  const isInviteMode = !!inviteData;
  const isOpenRegistration = isSelfHosted && !inviteData && !inviteToken;
  const hasEmailDomainRestriction = allowedEmailDomains.length > 0;

  // If signup is disabled and there's no invite, show a closed registration message
  if (!isSignupEnabled && !inviteData && !inviteToken) {
    return (
      <div className={cn("flex flex-col gap-6", className)}>
        <div className="flex flex-col items-center gap-3 text-center">
          <Link
            href="/"
            className="flex flex-col items-center gap-3 font-medium"
          >
            <div className="flex size-14 items-center justify-center rounded-md">
              <SupercheckLogo className="size-12" />
            </div>
            <span className="sr-only">Supercheck</span>
          </Link>
          <h1 className="text-2xl font-bold">Registration Closed</h1>
          <p className="text-sm text-muted-foreground max-w-[300px]">
            New account registration is currently disabled. Please contact your administrator for access.
          </p>
          <div className="mt-4 text-center text-sm">
            <p className="text-muted-foreground">
              Already have an account?{" "}
              <Link
                href="/sign-in"
                className="font-medium underline underline-offset-2"
              >
                Sign in instead
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show loading state while fetching invite data (when invite token is present but data hasn't loaded)
  if (!inviteData && !isOpenRegistration) {
    return (
      <div className={cn("flex flex-col gap-6 items-center justify-center min-h-[300px]", className)}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading invitation...</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <Form {...form}>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            {/* Header */}
            <div className="flex flex-col items-center gap-3 text-center">
              <Link
                href="/"
                className="flex flex-col items-center gap-3 font-medium"
              >
                <div className="flex size-14 items-center justify-center rounded-md">
                  <SupercheckLogo className="size-12" />
                </div>
                <span className="sr-only">Supercheck</span>
              </Link>
              <h1 className="text-2xl font-bold">
                {isInviteMode
                  ? `Join ${inviteData.organizationName}`
                  : "Create your account"}
              </h1>
              <FieldDescription>
                {isInviteMode ? (
                  <>
                    You&apos;ve been invited to join as{" "}
                    <span className="font-medium text-foreground">
                      {inviteData.role.replace(/_/g, " ")}
                    </span>
                  </>
                ) : (
                  "Sign up to get started with Supercheck"
                )}
              </FieldDescription>
            </div>

            {/* Invitation badge - only show in invite mode */}
            {isInviteMode && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                  <Mail className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Invitation for</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {inviteData.email}
                  </p>
                </div>
              </div>
            )}

            {/* Open registration callout - only show in self-hosted open registration */}
            {isOpenRegistration && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border/50 text-sm">
                <Building2 className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-foreground">Joining an existing team?</p>
                  <p className="text-muted-foreground mt-0.5">
                    Ask your admin for an invite to join their organization instead of creating a new one.
                  </p>
                </div>
              </div>
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
                        placeholder={isOpenRegistration ? "m@example.com" : undefined}
                        autoComplete="email"
                        readOnly={isInviteMode}
                        className={isInviteMode ? "bg-muted/50" : ""}
                        {...field}
                      />
                    </FormControl>
                    {hasEmailDomainRestriction && !isInviteMode && (
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
              <p className="text-sm font-medium text-destructive text-center">
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
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isInviteMode ? "Create account & join" : "Create account"}
              </Button>
            </Field>


            {/* Link to sign-in for existing users */}
            <div className="text-center text-sm">
              <FieldDescription>
                Already have an account?{" "}
                <Link
                  href={inviteToken ? `/sign-in?invite=${inviteToken}` : "/sign-in"}
                  className="font-medium underline underline-offset-2"
                >
                  Sign in instead
                </Link>
              </FieldDescription>
            </div>
          </FieldGroup>
        </form>
      </Form>

      {/* Footer (cloud mode only; hidden until config is resolved to avoid mode flicker) */}
      {shouldShowLegalFooter && (
        <FieldDescription className="px-6 text-center">
          By clicking continue, you agree to our{" "}
          <Link href="https://supercheck.io/terms">Terms of Service</Link> and{" "}
          <Link href="https://supercheck.io/privacy">Privacy Policy</Link>.
        </FieldDescription>
      )}

      {/* Invisible CAPTCHA - placed outside form to avoid any layout shift */}
      <TurnstileCaptcha
        ref={externalCaptchaRef ?? captchaRef}
        onSuccess={handleCaptchaSuccess}
        onError={handleCaptchaError}
        onExpire={handleCaptchaExpire}
      />
    </div>
  );
}


