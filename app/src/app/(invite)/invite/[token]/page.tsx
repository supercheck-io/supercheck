"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight } from "lucide-react";
import { FieldGroup, Field } from "@/components/ui/field";
import { AuthCallout, AuthCard, AuthHeader, AuthLegal, AuthLoading, InviteBanner, formatInviteRole } from "@/components/auth/auth-shell";
import { useSession } from "@/utils/auth-client";
import { signOutAndClear } from "@/lib/auth/sign-out";
import { useAppConfig } from "@/hooks/use-app-config";
import { clearProjectsCache } from "@/hooks/use-project-context";
import { announceProjectChange, reloadProjectContext } from "@/lib/project-navigation";

const INVITEE_LANDING_PATH = "/setup/welcome";

interface InvitationData {
  organizationName: string;
  email?: string;
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
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [emailMismatch, setEmailMismatch] = useState(false);
  const { data: session } = useSession();
  const router = useRouter();
  const { isCloudHosted, isFetched, error: configError } = useAppConfig();
  const shouldShowLegalFooter = isFetched && !configError && isCloudHosted;

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
        announceProjectChange();
        setAccepted(data.data);
        // An invitee picks a persona first, then lands on the dashboard (after 3 seconds)
        setTimeout(() => {
          reloadProjectContext(clearProjectsCache, INVITEE_LANDING_PATH);
        }, 3000);
      } else {
        if (data.code === "EMAIL_NOT_VERIFIED") {
          const inviteQuery = encodeURIComponent(token);
          router.push(`/verify-email?email=${encodeURIComponent(invitation?.email || "")}&invite=${inviteQuery}`);
          return;
        }
        // The signed-in account is not the invitee: sign out is the only way forward, never sign-up.
        if (data.code === "EMAIL_MISMATCH") {
          setEmailMismatch(true);
          return;
        }
        if (data.code === "INVITE_UNAVAILABLE") {
          // Dead invitation: drop it so the error links don't carry the token.
          setInvitation(null);
          setError(data.error);
          return;
        }
        const errorMessage = String(data.error ?? "").toLowerCase();
        if (
          response.status === 401 ||
          errorMessage.includes("sign in") ||
          errorMessage.includes("sign up") ||
          errorMessage.includes("authenticate")
        ) {
          // Sign-up is the common case; an existing account is told how to sign in by email,
          // and sign-up links to sign-in. Which one applies is deliberately not revealed here.
          router.push(`/sign-up?invite=${encodeURIComponent(token)}`);
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

  const handleSignOut = async () => {
    setSignOutError(null);
    try {
      const result = await signOutAndClear();
      if (result?.error) throw new Error(result.error.message);
      setEmailMismatch(false);
    } catch (signOutFailure) {
      setSignOutError(signOutFailure instanceof Error && signOutFailure.message ? signOutFailure.message : "Failed to sign out. Please try again.");
    }
  };

  // Loading State
  if (loading) return <AuthLoading label="Loading invitation…" />;

  // Error State
  if (error) {
    // A dead (expired, used, unknown) invite must not travel on: it would loop back here after sign-in.
    const inviteQuery = invitation ? `?invite=${encodeURIComponent(token)}` : "";
    return (
      <AuthCard>
        <FieldGroup>
          <AuthHeader status="error" title="Invalid invitation" description={error} />

          <Field className="flex flex-col gap-2">
            <Button size="lg" onClick={() => router.push(`/sign-in${inviteQuery}`)} className="w-full">
              Go to sign in
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => router.push(`/sign-up${inviteQuery}`)}
              className="w-full"
            >
              Create new account
            </Button>
          </Field>
        </FieldGroup>
      </AuthCard>
    );
  }

  // Signed in as someone other than the invitee
  if (emailMismatch) {
    return (
      <AuthCard>
        <FieldGroup>
          <AuthHeader
            status="error"
            title="Wrong account"
            description={
              <>
                {session?.user?.email ? (
                  <>You are signed in as <span className="font-medium text-foreground">{session.user.email}</span>, but this invitation is for a different email address.</>
                ) : (
                  <>You are signed in with a different email address than this invitation is for.</>
                )}{" "}
                Sign out, then sign in with the invited account.
              </>
            }
          />
          {invitation ? (
            <InviteBanner organizationName={invitation.organizationName} role={invitation.role} email={invitation.email} />
          ) : null}
          {signOutError && <AuthCallout variant="error">{signOutError}</AuthCallout>}
          <Field>
            <Button size="lg" onClick={handleSignOut} className="w-full">
              Sign out
            </Button>
          </Field>
        </FieldGroup>
      </AuthCard>
    );
  }

  // Success State - Invitation Accepted
  if (accepted) {
    return (
      <AuthCard>
        <FieldGroup>
          <AuthHeader
            status="success"
            title={`Welcome to ${accepted.organizationName}`}
            description={
              <>
                You now have{" "}
                <span className="font-medium text-foreground">{formatInviteRole(accepted.role)}</span> access.
              </>
            }
          />

          <div role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span>Redirecting to dashboard…</span>
          </div>

          <Field>
            <Button size="lg" onClick={() => reloadProjectContext(clearProjectsCache, INVITEE_LANDING_PATH)} className="w-full">
              Go to dashboard
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Field>
        </FieldGroup>
      </AuthCard>
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
      <AuthCard footer={shouldShowLegalFooter ? <AuthLegal action="accepting" /> : undefined}>
        <FieldGroup>
          <AuthHeader
            logoHref="/"
            title="You're invited"
            description={`Join ${invitation.organizationName} on Supercheck`}
          />

          <InviteBanner
            organizationName={invitation.organizationName}
            role={invitation.role}
            email={invitation.email}
            invitedBy={invitation.inviterName}
          />

          {isExpiringSoon && (
            <AuthCallout variant="warning">
              Expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? "s" : ""}
            </AuthCallout>
          )}

          <Field className="flex gap-3">
            <Button size="lg" onClick={handleAcceptInvitation} disabled={accepting} className="flex-1">
              {accepting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Joining...
                </>
              ) : (
                <>
                  Accept invitation
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
            <Button size="lg" variant="outline" onClick={() => router.push("/")} className="flex-1">
              Decline
            </Button>
          </Field>
        </FieldGroup>
      </AuthCard>
    );
  }

  return null;
}
