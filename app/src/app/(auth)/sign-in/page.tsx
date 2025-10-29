"use client";
import { signIn } from "@/utils/auth-client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
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
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [isFromNotification, setIsFromNotification] = useState(false);

  useEffect(() => {
    const invite = searchParams.get('invite');
    const from = searchParams.get('from');
    
    if (invite) {
      setInviteToken(invite);
      fetchInviteData(invite);
    }
    
    if (from === 'notification') {
      setIsFromNotification(true);
    }
  }, [searchParams]);

  const fetchInviteData = async (token: string) => {
    try {
      const response = await fetch(`/api/invite/${token}`);
      const data = await response.json();
      if (data.success) {
        setInviteData(data.data);
      }
    } catch (error) {
      console.error('Error fetching invite data:', error);
    }
  };

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
      className="w-full max-w-4xl"
      onSubmit={handleSubmit}
      isLoading={isLoading}
      error={error}
      inviteData={inviteData}
      inviteToken={inviteToken}
      isFromNotification={isFromNotification}
    />
  );
} 