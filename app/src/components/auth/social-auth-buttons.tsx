"use client";

import { Button } from "@/components/ui/button";
import { authClient, signIn } from "@/utils/auth-client";
import { useState, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { GitHubIcon, GoogleIcon } from "./social-icons";
import { useAuthProviders } from "@/hooks/use-auth-providers";
import { Badge } from "@/components/ui/badge";

interface SocialAuthButtonsProps {
  mode: "signin" | "signup";
  callbackUrl?: string;
  disabled?: boolean;
}

export function SocialAuthButtons({
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

  // Get the last used login method for "Last used" badge
  const lastMethod = useMemo(() => {
    try {
      return authClient.getLastUsedLoginMethod?.() ?? null;
    } catch {
      return null;
    }
  }, []);

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

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="text-sm font-medium text-destructive text-center">
          {error}
        </p>
      )}

      {/* Always stack vertically for clean, professional look */}
      <div className="flex flex-col gap-3">
        {isGoogleEnabled && (
          <div className="relative w-full">
            {lastMethod === "google" && (
              <Badge
                variant="secondary"
                className="absolute -top-1 -right-1 text-[10px] uppercase tracking-wide py-0 px-1.5 font-medium"
                data-testid="last-used-badge"
              >
                Last used
              </Badge>
            )}
            <Button
              type="button"
              variant={lastMethod === "google" ? "default" : "outline"}
              size="lg"
              className="w-full justify-center gap-3"
              onClick={handleGoogleSignIn}
              disabled={isDisabled}
              data-testid="login-google-button"
            >
              {isGoogleLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <GoogleIcon className="h-5 w-5" />
              )}
              <span>Continue with Google</span>
            </Button>
          </div>
        )}

        {isGithubEnabled && (
          <div className="relative w-full">
            {lastMethod === "github" && (
              <Badge
                variant="secondary"
                className="absolute -top-1 -right-1 text-[10px] uppercase tracking-wide py-0 px-1.5 font-medium"
                data-testid="last-used-badge"
              >
                Last used
              </Badge>
            )}
            <Button
              type="button"
              variant={lastMethod === "github" ? "default" : "outline"}
              size="lg"
              className="w-full justify-center gap-3"
              onClick={handleGitHubSignIn}
              disabled={isDisabled}
              data-testid="login-github-button"
            >
              {isGithubLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <GitHubIcon className="h-5 w-5" />
              )}
              <span>Continue with GitHub</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}


