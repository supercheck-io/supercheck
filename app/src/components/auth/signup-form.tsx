"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckIcon } from "@/components/logo/supercheck-logo";
import { Loader2, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { SocialAuthButtons } from "./social-auth-buttons";
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
}

export function SignupForm({
  className,
  onSubmit,
  isLoading,
  error,
  inviteData,
  inviteToken,
}: SignupFormProps) {
  const [showPassword, setShowPassword] = useState(false);

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
                  <CheckIcon className="size-12" />
                </div>
                <span className="sr-only">Supercheck</span>
              </Link>
              <h1 className="text-2xl font-bold">
                {inviteData
                  ? `Join ${inviteData.organizationName}`
                  : "Welcome to Supercheck"}
              </h1>
              <FieldDescription>
                {inviteData ? (
                  <>
                    Create an account to join as{" "}
                    <span className="font-medium text-foreground">
                      {inviteData.role.replace(/_/g, " ")}
                    </span>
                    <br />
                    <span className="text-xs">
                      Already have an account?{" "}
                      <Link
                        href={`/sign-in?invite=${inviteToken}`}
                        className="underline underline-offset-2"
                      >
                        Sign in instead
                      </Link>
                    </span>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <Link
                      href={
                        inviteToken
                          ? `/sign-in?invite=${inviteToken}`
                          : "/sign-in"
                      }
                    >
                      Sign in
                    </Link>
                  </>
                )}
              </FieldDescription>
            </div>

            {/* Social Auth - Only show when NOT from an invitation */}
            {/* For invitations, user must sign up with the invited email address */}
            {!inviteData && (
              <>
                <SocialAuthButtons
                  mode="signup"
                  callbackUrl={inviteToken ? `/invite/${inviteToken}` : "/"}
                  disabled={isLoading}
                />

                {/* Separator */}
                <FieldSeparator>Or continue with email</FieldSeparator>
              </>
            )}

            {/* Name Field */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <Field>
                    <FieldLabel htmlFor="name">Name</FieldLabel>
                    <FormControl>
                      <Input
                        id="name"
                        placeholder="John Doe"
                        autoComplete="name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </Field>
                </FormItem>
              )}
            />

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
                        readOnly={!!inviteData}
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
                    <FieldLabel htmlFor="password">Password</FieldLabel>
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

            {/* Submit Button */}
            <Field>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create account
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </Form>

      {/* Footer */}
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our{" "}
        <Link href="/terms">Terms of Service</Link> and{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </FieldDescription>
    </div>
  );
}
