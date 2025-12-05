"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  UserCheck,
  Building2,
  Loader2,
  Crown,
  Shield,
  User,
  AlertTriangle,
  Info,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface OrganizationRole {
  organizationId: string;
  organizationName: string;
  role: string;
}

interface ImpersonateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  userEmail: string;
}

export function ImpersonateDialog({
  open,
  onOpenChange,
  userId,
  userName,
  userEmail,
}: ImpersonateDialogProps) {
  const [organizations, setOrganizations] = useState<OrganizationRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const fetchUserOrganizations = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/users/${userId}/organizations`);
      if (response.ok) {
        const data = await response.json();
        setOrganizations(data.organizations || []);
        // Auto-select first org if only one
        if (data.organizations?.length === 1) {
          setSelectedOrgId(data.organizations[0].organizationId);
        }
      } else {
        console.error("Failed to fetch user organizations");
        toast.error("Failed to load user organizations");
      }
    } catch (error) {
      console.error("Error fetching organizations:", error);
      toast.error("Failed to load user organizations");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (open && userId) {
      fetchUserOrganizations();
      setSelectedOrgId(null);
    }
  }, [open, userId, fetchUserOrganizations]);

  const handleImpersonate = async (organizationId?: string) => {
    setImpersonating(true);
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "impersonate",
          organizationId,
        }),
      });

      const data = await response.json();

      if (data.success) {
        const orgName = organizations.find(
          (o) => o.organizationId === organizationId
        )?.organizationName;
        const message = organizationId
          ? `Now impersonating ${userName} in ${orgName}`
          : `Now impersonating ${userName}`;

        toast.success(message);
        onOpenChange(false);
        window.location.href = "/";
      } else {
        toast.error(data.error || "Failed to impersonate user");
      }
    } catch (error) {
      console.error("Error impersonating user:", error);
      toast.error("Failed to impersonate user");
    } finally {
      setImpersonating(false);
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "org_owner":
        return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300";
      case "org_admin":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
      case "project_editor":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
      case "project_viewer":
        return "bg-gray-100 text-gray-800 dark:bg-gray-800/30 dark:text-gray-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800/30 dark:text-gray-300";
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "org_owner":
        return <Crown className="h-3.5 w-3.5" />;
      case "org_admin":
        return <Shield className="h-3.5 w-3.5" />;
      case "project_editor":
        return <UserCheck className="h-3.5 w-3.5" />;
      case "project_viewer":
        return <User className="h-3.5 w-3.5" />;
      default:
        return <User className="h-3.5 w-3.5" />;
    }
  };

  const getDisplayRole = (role: string) => {
    switch (role) {
      case "org_owner":
        return "Owner";
      case "org_admin":
        return "Admin";
      case "project_editor":
        return "Editor";
      case "project_viewer":
        return "Viewer";
      default:
        return role.replace("_", " ");
    }
  };

  const handleClose = () => {
    if (!impersonating) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <UserCheck className="h-4 w-4 text-primary" />
            </div>
            <span>Impersonate User</span>
          </DialogTitle>
          <DialogDescription className="pt-1.5">
            Sign in as <strong className="text-foreground">{userName}</strong>{" "}
            <span className="text-muted-foreground">({userEmail})</span> to test
            their permissions.
          </DialogDescription>
        </DialogHeader>

        <Separator className="my-1" />

        <div className="space-y-4 py-2">
          <Alert
            variant="default"
            className="border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/20"
          >
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
            <AlertTitle className="text-amber-800 dark:text-amber-400">
              Security Notice
            </AlertTitle>
            <AlertDescription className="text-amber-700 dark:text-amber-400/80">
              This action is logged. You will see the platform as this user
              would.
            </AlertDescription>
          </Alert>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">
                Loading organizations...
              </span>
            </div>
          ) : organizations.length === 0 ? (
            <div className="text-center py-6 space-y-4">
              <div className="flex flex-col items-center gap-2">
                <div className="rounded-full bg-muted p-3">
                  <Building2 className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground text-sm">
                  This user has no organization memberships.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {organizations.length === 1
                    ? "This user belongs to one organization:"
                    : `Select an organization to impersonate in (${organizations.length} available):`}
                </p>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {organizations.map((org) => (
                  <button
                    key={org.organizationId}
                    type="button"
                    onClick={() => setSelectedOrgId(org.organizationId)}
                    className={`w-full border rounded-lg p-3 text-left transition-all ${
                      selectedOrgId === org.organizationId
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:border-muted-foreground/40 hover:bg-muted/50"
                    }`}
                    disabled={impersonating}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-9 w-9 items-center justify-center rounded-md ${
                            selectedOrgId === org.organizationId
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          }`}
                        >
                          <Building2 className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">
                            {org.organizationName}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Badge
                              variant="secondary"
                              className={`text-[10px] px-1.5 py-0 ${getRoleColor(org.role)}`}
                            >
                              {getRoleIcon(org.role)}
                              <span className="ml-1">
                                {getDisplayRole(org.role)}
                              </span>
                            </Badge>
                          </div>
                        </div>
                      </div>
                      {selectedOrgId === org.organizationId && (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                          <svg
                            className="h-3 w-3 text-primary-foreground"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={3}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <Separator className="my-1" />

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={impersonating}
          >
            Cancel
          </Button>
          <Button
            onClick={() => handleImpersonate(selectedOrgId || undefined)}
            disabled={
              impersonating || (organizations.length > 0 && !selectedOrgId)
            }
          >
            {impersonating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Impersonating...
              </>
            ) : (
              <>
                <UserCheck className="mr-2 h-4 w-4" />
                {organizations.length === 0
                  ? "Impersonate Anyway"
                  : "Impersonate User"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
