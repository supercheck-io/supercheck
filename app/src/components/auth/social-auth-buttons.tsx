"use client";

import { Button } from "@/components/ui/button";
import { authClient, signIn } from "@/utils/auth-client";
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { GitHubIcon, GoogleIcon } from "./social-icons";
import { Badge } from "@/components/ui/badge";

interface SocialAuthButtonsProps {
  callbackUrl?: string;
  disabled?: boolean;
}

export function SocialAuthButtons({
  callbackUrl = "/",
  disabled = false,
}: SocialAuthButtonsProps) {
  const [isGithubLoading, setIsGithubLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // HYDRATION FIX: Initialize with null on server and client, then update in effect
  const [lastMethod, setLastMethod] = useState<string | null>(null);
  
  useEffect(() => {
    // Defer state update to avoid cascading renders
    const timer = setTimeout(() => {
      try {
        const method = authClient.getLastUsedLoginMethod?.() ?? null;
        setLastMethod(method);
      } catch {
        // Ignore errors reading from localStorage
      }
    }, 0);
    
    return () => clearTimeout(timer);
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
  const isDisabled = disabled || isLoading;

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="text-sm font-medium text-destructive text-center">
          {error}
        </p>
      )}

      {/* Always show both OAuth buttons - they are always visible */}
      <div className="flex flex-col gap-3">
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
      </div>
    </div>
  );
}
