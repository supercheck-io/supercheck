"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  AlertCircle,
  Loader2,
  Building2,
  Users,
  Clock,
  ArrowRight,
  Mail,
  Shield,
} from "lucide-react";
import { CheckIcon } from "@/components/logo/supercheck-logo";
import { FieldGroup, Field, FieldDescription } from "@/components/ui/field";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface InvitationData {
  organizationName: string;
  email: string;
  role: string;
  expiresAt: string;
  inviterName?: string;
  inviterEmail?: string;
  projectsCount?: number;
}

interface AcceptedData {
  organizationName: string;
  role: string;
  message: string;
}

export default function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [token, setToken] = useState<string>("");
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [accepted, setAccepted] = useState<AcceptedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Get token from params
  useEffect(() => {
    params.then(({ token }) => setToken(token));
  }, [params]);

  // Fetch invitation details
  useEffect(() => {
    if (!token) return;

    async function fetchInvitation() {
      try {
        const response = await fetch(`/api/invite/${token}`);
        const data = await response.json();

        if (data.success) {
          setInvitation(data.data);
        } else {
          setError(data.error || "Failed to load invitation");
        }
      } catch (error) {
        console.error("Error fetching invitation:", error);
        setError("Failed to load invitation");
      } finally {
        setLoading(false);
      }
    }

    fetchInvitation();
  }, [token]);

  const handleAcceptInvitation = async () => {
    if (!token) return;

    setAccepting(true);
    try {
      const response = await fetch(`/api/invite/${token}`, {
        method: "POST",
      });
      const data = await response.json();

      if (data.success) {
        setAccepted(data.data);
        // Redirect to dashboard after 3 seconds
        setTimeout(() => {
          router.push("/");
        }, 3000);
      } else {
        if (
          data.error &&
          (data.error.includes("sign in") ||
            data.error.includes("sign up") ||
            data.error.includes("authenticate"))
        ) {
          // User needs to authenticate - redirect to sign-up with invitation token
          // Sign-up is preferred since most invited users are new
          router.push(`/sign-up?invite=${token}`);
        } else {
          setError(data.error || "Failed to accept invitation");
        }
      }
    } catch (error) {
      console.error("Error accepting invitation:", error);
      setError("Failed to accept invitation");
    } finally {
      setAccepting(false);
    }
  };

  const getRoleBadgeStyle = (role: string) => {
    switch (role.toLowerCase()) {
      case "org_owner":
        return "bg-purple-500/10 text-purple-500 border-purple-500/20";
      case "org_admin":
        return "bg-amber-500/10 text-amber-500 border-amber-500/20";
      case "project_editor":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "project_viewer":
        return "bg-slate-500/10 text-slate-500 border-slate-500/20";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const formatRoleName = (role: string) => {
    return role
      .replace("_", " ")
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  // Loading State
  if (loading) {
    return (
      <div className="flex flex-col gap-6 w-full max-w-md">
        <FieldGroup>
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-14 items-center justify-center rounded-md">
              <CheckIcon className="size-12" />
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading invitation...</span>
            </div>
          </div>
        </FieldGroup>
      </div>
    );
  }

  // Error State
  if (error) {
    return (
      <div className="flex flex-col gap-6 w-full max-w-md">
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="size-6 text-destructive" />
            </div>
            <h1 className="text-xl font-bold">Invalid Invitation</h1>
            <FieldDescription className="text-center">{error}</FieldDescription>
          </div>

          <Field className="flex flex-col gap-2">
            <Button onClick={() => router.push("/sign-in")} className="w-full">
              Go to Sign In
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/sign-up")}
              className="w-full"
            >
              Create New Account
            </Button>
          </Field>
        </FieldGroup>
      </div>
    );
  }

  // Success State - Invitation Accepted
  if (accepted) {
    return (
      <div className="flex flex-col gap-6 w-full max-w-md">
        <FieldGroup>
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-green-500/10">
              <CheckCircle className="size-8 text-green-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold">
                Welcome to {accepted.organizationName}!
              </h1>
              <FieldDescription className="mt-2">
                You now have{" "}
                <span className="font-medium text-foreground">
                  {formatRoleName(accepted.role)}
                </span>{" "}
                access.
              </FieldDescription>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Redirecting to dashboard...</span>
          </div>

          <Field>
            <Button onClick={() => router.push("/")} className="w-full">
              Go to Dashboard
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Field>
        </FieldGroup>
      </div>
    );
  }

  // Invitation Details
  if (invitation) {
    const daysUntilExpiry = Math.ceil(
      (new Date(invitation.expiresAt).getTime() - new Date().getTime()) /
      (1000 * 60 * 60 * 24)
    );
    const isExpiringSoon = daysUntilExpiry <= 2;

    return (
      <div className="flex flex-col gap-6 w-full max-w-md">
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
            <h1 className="text-2xl font-bold">You&apos;re Invited!</h1>
            <FieldDescription>
              Join {invitation.organizationName} on Supercheck
            </FieldDescription>
          </div>

          {/* Invitation Details Card */}
          <div className="rounded-lg border bg-card p-6 space-y-4">
            {/* Organization */}
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
                <Building2 className="size-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Organization</p>
                <p className="font-medium">{invitation.organizationName}</p>
              </div>
            </div>

            {/* Role */}
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
                <Shield className="size-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Your Role</p>
                <Badge
                  className={cn("mt-0.5", getRoleBadgeStyle(invitation.role))}
                >
                  {formatRoleName(invitation.role)}
                </Badge>
              </div>
            </div>

            {/* Email */}
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
                <Mail className="size-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Invited Email</p>
                <p className="font-medium">{invitation.email}</p>
              </div>
            </div>

            {/* Inviter */}
            {invitation.inviterName && (
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
                  <Users className="size-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Invited By</p>
                  <p className="font-medium">{invitation.inviterName}</p>
                </div>
              </div>
            )}

            {/* Expiry Warning */}
            {isExpiringSoon && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
                <Clock className="h-4 w-4 text-amber-500" />
                <span className="text-sm text-amber-600 dark:text-amber-400">
                  Expires in {daysUntilExpiry} day
                  {daysUntilExpiry !== 1 ? "s" : ""}
                </span>
              </div>
            )}
          </div>

          {/* Actions */}
          <Field className="flex gap-3">
            <Button
              onClick={handleAcceptInvitation}
              disabled={accepting}
              className="flex-1"
            >
              {accepting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Joining...
                </>
              ) : (
                <>
                  Accept Invitation
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/")}
              className="flex-1"
            >
              Decline
            </Button>
          </Field>
        </FieldGroup>

        {/* Footer */}
        <FieldDescription className="px-6 text-center">
          By accepting, you agree to our{" "}
          <Link href="https://supercheck.io/terms">Terms of Service</Link> and{" "}
          <Link href="https://supercheck.io/privacy">Privacy Policy</Link>.
        </FieldDescription>
      </div>
    );
  }

  return null;
}
