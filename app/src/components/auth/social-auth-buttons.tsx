"use client";

import { Button } from "@/components/ui/button";
import { signIn } from "@/utils/auth-client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { GitHubIcon, GoogleIcon } from "./social-icons";

interface SocialAuthButtonsProps {
  mode: "signin" | "signup";
  callbackUrl?: string;
  disabled?: boolean;
}

export function SocialAuthButtons({
  mode,
  callbackUrl = "/",
  disabled = false
}: SocialAuthButtonsProps) {
  const [isGithubLoading, setIsGithubLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGitHubSignIn = async () => {
    try {
      setError(null);
      setIsGithubLoading(true);

      // Encode the final callback URL as a query parameter
      const authCallbackUrl = `/auth-callback?callbackUrl=${encodeURIComponent(callbackUrl)}`;

      await signIn.social({
        provider: "github",
        callbackURL: authCallbackUrl,
      });
    } catch (err) {
      console.error("GitHub sign in error:", err);
      setError("Failed to sign in with GitHub. Please try again.");
      setIsGithubLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setError(null);
      setIsGoogleLoading(true);

      // Encode the final callback URL as a query parameter
      const authCallbackUrl = `/auth-callback?callbackUrl=${encodeURIComponent(callbackUrl)}`;

      await signIn.social({
        provider: "google",
        callbackURL: authCallbackUrl,
      });
    } catch (err) {
      console.error("Google sign in error:", err);
      setError("Failed to sign in with Google. Please try again.");
      setIsGoogleLoading(false);
    }
  };

  const isLoading = isGithubLoading || isGoogleLoading;
  const isDisabled = disabled || isLoading;

  // Check if social providers are enabled via environment variables
  const isGithubEnabled = !!(
    process.env.NEXT_PUBLIC_GITHUB_ENABLED === "true"
  );
  const isGoogleEnabled = !!(
    process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true"
  );

  // Don't render if no social providers are enabled
  if (!isGithubEnabled && !isGoogleEnabled) {
    return null;
  }

  const actionText = mode === "signin" ? "Sign in" : "Sign up";

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="text-red-500 text-sm text-center">{error}</p>
      )}

      {isGoogleEnabled && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGoogleSignIn}
          disabled={isDisabled}
        >
          {isGoogleLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <GoogleIcon className="mr-2 h-4 w-4" />
          )}
          {actionText} with Google
        </Button>
      )}

      {isGithubEnabled && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGitHubSignIn}
          disabled={isDisabled}
        >
          {isGithubLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <GitHubIcon className="mr-2 h-4 w-4" />
          )}
          {actionText} with GitHub
        </Button>
      )}

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">
            Or continue with email
          </span>
        </div>
      </div>
    </div>
  );
}
