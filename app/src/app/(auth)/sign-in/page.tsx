"use client";
import { signIn } from "@/utils/auth-client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, useMemo } from "react";
import { LoginForm } from "@/components/auth/login-form";

interface InviteData {
  organizationName: string;
  role: string;
  email?: string;
}

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [isFromNotification, setIsFromNotification] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);

  // Derive invite token from URL params (not state)
  const inviteToken = useMemo(() => searchParams.get("invite"), [searchParams]);

  // Fetch invite data - defined before useEffect that uses it
  const fetchInviteData = useCallback(async (token: string) => {
    try {
      const response = await fetch(`/api/invite/${token}`);
      const data = await response.json();
      if (data.success) {
        setInviteData(data.data);
      }
    } catch (fetchError) {
      console.error("Error fetching invite data:", fetchError);
    }
  }, []);

  useEffect(() => {
    const from = searchParams.get("from");
    const verified = searchParams.get("verified");

    // Defer fetchInviteData to avoid synchronous setState in effect body
    if (inviteToken) {
      setTimeout(() => fetchInviteData(inviteToken), 0);
    }

    // Defer state updates to avoid synchronous setState in effect body
    if (from === "notification") {
      setTimeout(() => setIsFromNotification(true), 0);
    }

    // Check if user just verified their email
    if (verified === "true") {
      setTimeout(() => {
        setEmailVerified(true);
        // Clean up the URL without refreshing the page
        const url = new URL(window.location.href);
        url.searchParams.delete("verified");
        window.history.replaceState({}, "", url.toString());
      }, 0);
    }
  }, [searchParams, inviteToken, fetchInviteData]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    const formData = new FormData(event.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const { error } = await signIn.email({ email, password });

    if (error) {
      setError(error.message || "An error occurred");
    } else {
      // If user signed in with an invite token, redirect to accept invitation
      if (inviteToken) {
        router.push(`/invite/${inviteToken}`);
      } else {
        router.push("/");
      }
    }
    setIsLoading(false);
  };

  return (
    <LoginForm
      className="w-full max-w-sm px-4"
      onSubmit={handleSubmit}
      isLoading={isLoading}
      error={error}
      inviteData={inviteData}
      inviteToken={inviteToken}
      isFromNotification={isFromNotification}
      emailVerified={emailVerified}
    />
  );
}
