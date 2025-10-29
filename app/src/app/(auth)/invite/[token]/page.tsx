"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";

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

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
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
          setError(data.error || 'Failed to load invitation');
        }
      } catch (error) {
        console.error('Error fetching invitation:', error);
        setError('Failed to load invitation');
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
        method: 'POST',
      });
      const data = await response.json();

      if (data.success) {
        setAccepted(data.data);
        // Redirect to dashboard after 3 seconds
        setTimeout(() => {
          router.push('/');
        }, 3000);
      } else {
        if (data.error && data.error.includes('sign in')) {
          // Redirect to sign in with invitation token
          router.push(`/sign-in?invite=${token}`);
        } else {
          setError(data.error || 'Failed to accept invitation');
        }
      }
    } catch (error) {
      console.error('Error accepting invitation:', error);
      setError('Failed to accept invitation');
    } finally {
      setAccepting(false);
    }
  };

  const getRoleColor = (role: string) => {
    switch (role.toLowerCase()) {
      case 'org_owner': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'org_admin': return 'bg-red-100 text-red-800 border-red-200';
      case 'project_editor': return 'bg-green-100 text-green-800 border-green-200';
      case 'project_viewer': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-center space-x-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Loading invitation...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              <span>Invalid Invitation</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">{error}</p>
            <div className="space-y-2">
              <Button onClick={() => router.push('/sign-in')} className="w-full">
                Go to Sign In
              </Button>
              <Button variant="outline" onClick={() => router.push('/sign-up')} className="w-full">
                Create New Account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              <span>Invitation Accepted!</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">Welcome to {accepted.organizationName}! You now have {accepted.role} access.</p>
            <p className="text-sm text-gray-500 mb-4">
              Redirecting to dashboard in 3 seconds...
            </p>
            <Button onClick={() => router.push('/')} className="w-full">
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (invitation) {
    const daysUntilExpiry = Math.ceil((new Date(invitation.expiresAt).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    const isExpiringSoon = daysUntilExpiry <= 2;

    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Organization Invitation</CardTitle>
            <CardDescription>
              You&apos;ve been invited to join {invitation.organizationName} as a {invitation.role}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Role</label>
              <div className="mt-1">
                <Badge className={getRoleColor(invitation.role)}>
                  {invitation.role.charAt(0).toUpperCase() + invitation.role.slice(1)}
                </Badge>
              </div>
            </div>
            
            {isExpiringSoon && (
              <Alert className="border-amber-200 bg-amber-50">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                  Expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex space-x-2 pt-4">
              <Button
                onClick={handleAcceptInvitation}
                disabled={accepting}
                className="flex-1"
              >
                {accepting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Accepting...
                  </>
                ) : (
                  'Accept'
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push('/sign-in')}
                className="flex-1"
              >
                Decline
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}