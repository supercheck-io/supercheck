"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SupercheckLogo } from "@/components/logo/supercheck-logo";
import { Loader2, Eye, EyeOff, Mail } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { TurnstileCaptcha } from "./turnstile-captcha";
import { useCaptcha } from "@/hooks/use-captcha";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
}

/**
 * SignupForm Component - INVITATION ONLY
 * 
 * This form is exclusively for invited users to create an account.
 * New users without invitation use the sign-in page with social auth.
 * 
 * Key features:
 * - Email-only signup (no social buttons)
 * - Email locked to invited email address
 * - Clear invitation messaging
 */
export function SignupForm({
  className,
  onSubmit,
  isLoading,
  error,
  inviteData,
  inviteToken,
  onCaptchaToken,
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

  // Show loading state while fetching invite data
  if (!inviteData) {
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
            {/* Header with invitation context */}
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
                Join {inviteData.organizationName}
              </h1>
              <FieldDescription>
                You&apos;ve been invited to join as{" "}
                <span className="font-medium text-foreground">
                  {inviteData.role.replace(/_/g, " ")}
                </span>
              </FieldDescription>
            </div>

            {/* Invitation badge - shows invited email */}
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

            {/* Email Field - Read-only, locked to invited email */}
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
                        autoComplete="email"
                        readOnly
                        className="bg-muted/50"
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
                Create account & join
              </Button>
            </Field>


            {/* Link to sign-in for existing users */}
            <div className="text-center">
              <FieldDescription>
                Already have an account?{" "}
                <Link
                  href={`/sign-in?invite=${inviteToken}`}
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  Sign in instead
                </Link>
              </FieldDescription>
            </div>
          </FieldGroup>
        </form>
      </Form>

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


