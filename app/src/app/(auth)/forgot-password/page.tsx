"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckIcon } from "@/components/logo/supercheck-logo";
import { Loader2, ArrowLeft, CheckCircle } from "lucide-react";
import Link from "next/link";
import { forgetPassword } from "@/utils/auth-client";

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

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl">
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-2">
          <div className="p-6 md:p-8">
            {isSuccess ? (
              <div className="flex flex-col gap-6">
                <div className="flex flex-col items-center text-center gap-4">
                  <CheckCircle className="h-12 w-12 text-green-500" />
                  <h1 className="text-2xl font-bold">Check your email</h1>
                  <p className="text-muted-foreground text-balance">
                    We&apos;ve sent a password reset link to{" "}
                    <strong>{email}</strong>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    The link will expire in 1 hour for security reasons.
                  </p>
                </div>
                <div className="text-center text-sm">
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
                </div>
                <div className="text-center">
                  <Link
                    href="/sign-in"
                    className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back to sign in
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col items-center text-center">
                    <h1 className="text-2xl font-bold mb-1">Forgot password</h1>
                    <p className="text-muted-foreground text-balance text-sm">
                      Enter your email address and we&apos;ll send you a link to
                      reset your password.
                    </p>
                  </div>
                  <div className="grid gap-3">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="Enter your email address"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                  {error && <p className="text-red-500 text-sm">{error}</p>}
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoading || !email}
                  >
                    {isLoading && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Send reset link
                  </Button>
                  <div className="text-center">
                    <Link
                      href="/sign-in"
                      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Back to sign in
                    </Link>
                  </div>
                </div>
              </form>
            )}
          </div>
          <div className="bg-muted relative hidden md:block">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-3">
                <CheckIcon className="h-10 w-10" />
                <div className="grid text-left text-sm leading-tight">
                  <span className="font-semibold text-lg">Supercheck</span>
                  <span className="text-muted-foreground">
                    Automation & Monitoring for Modern Apps
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
