"use client";

import { Button } from "@/components/ui/button";
import { signIn } from "@/utils/auth-client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { GitHubIcon, GoogleIcon } from "./social-icons";
import { useAuthProviders } from "@/hooks/use-auth-providers";

interface SocialAuthButtonsProps {
  mode: "signin" | "signup";
  callbackUrl?: string;
  disabled?: boolean;
}

export function SocialAuthButtons({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mode,
  callbackUrl = "/",
  disabled = false,
}: SocialAuthButtonsProps) {
  const [isGithubLoading, setIsGithubLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    isGithubEnabled,
    isGoogleEnabled,
    isLoading: isProvidersLoading,
  } = useAuthProviders();

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
  const isDisabled = disabled || isLoading || isProvidersLoading;

  // Don't render if loading providers or no social providers are enabled
  if (isProvidersLoading || (!isGithubEnabled && !isGoogleEnabled)) {
    return null;
  }

  // Determine if we should use grid layout (both providers enabled)
  const useGridLayout = isGoogleEnabled && isGithubEnabled;

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="text-sm font-medium text-destructive text-center">
          {error}
        </p>
      )}

      <div
        className={
          useGridLayout ? "grid gap-3 sm:grid-cols-2" : "flex flex-col gap-3"
        }
      >
        {isGoogleEnabled && (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleGoogleSignIn}
            disabled={isDisabled}
          >
            {isGoogleLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GoogleIcon className="h-4 w-4" />
            )}
            <span className={useGridLayout ? "hidden sm:inline" : ""}>
              Continue with{" "}
            </span>
            Google
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
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GitHubIcon className="h-4 w-4" />
            )}
            <span className={useGridLayout ? "hidden sm:inline" : ""}>
              Continue with{" "}
            </span>
            GitHub
          </Button>
        )}
      </div>
    </div>
  );
}
