"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface DeleteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  userEmail: string;
  onSuccess: () => void;
}

interface OrgToDelete {
  id: string;
  name: string;
  hasActiveSubscription: boolean;
}

export function DeleteUserDialog({ open, onOpenChange, userId, userName, userEmail, onSuccess }: DeleteUserDialogProps) {
  const [orgs, setOrgs] = useState<OrgToDelete[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [typedEmail, setTypedEmail] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!open) {
      setOrgs(null);
      setLoadError(null);
      setTypedEmail("");
      return;
    }
    let cancelled = false;
    fetch(`/api/admin/users/${userId}/organizations`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.success) throw new Error(data.error || "Failed to load organizations");
        setOrgs(
          (data.organizations as Array<{ organizationId: string; organizationName: string; isOnlyMember: boolean; hasActiveSubscription: boolean }>)
            .filter((org) => org.isOnlyMember)
            .map((org) => ({ id: org.organizationId, name: org.organizationName, hasActiveSubscription: org.hasActiveSubscription })),
        );
      })
      .catch((error: unknown) => !cancelled && setLoadError(error instanceof Error ? error.message : "Failed to load organizations"));
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  const handleDelete = async () => {
    if (!orgs) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmDeleteOrganizationIds: orgs.map((org) => org.id) }),
      });
      const data = await res.json().catch(() => null);
      if (!data) {
        // Proxy timeout or error page: a large teardown can outlive the request but keep running.
        toast.error("No response from the server. The deletion may still be running; refresh the list before retrying.");
        return;
      }
      if (data.code === "confirm_organization_deletion") {
        // Memberships changed since the dialog opened: show the current list and ask again.
        setOrgs(data.organizations);
        setTypedEmail("");
        toast.error("The organizations to delete changed. Review the list and confirm again.");
        return;
      }
      if (!data.success) {
        toast.error(data.error || "Failed to delete user");
        // Some organizations may already be gone: show what is left.
        if (Array.isArray(data.deletedOrganizationIds) && data.deletedOrganizationIds.length) {
          setOrgs((current) => current?.filter((org) => !data.deletedOrganizationIds.includes(org.id)) ?? null);
          onSuccess();
        }
        return;
      }
      toast.success(orgs.length ? `User and ${orgs.length} organization${orgs.length > 1 ? "s" : ""} deleted` : "User deleted");
      onOpenChange(false);
      onSuccess();
    } catch {
      toast.error("Failed to delete user");
    } finally {
      setIsDeleting(false);
    }
  };

  const confirmedEmail = typedEmail.trim().toLowerCase() === userEmail.toLowerCase();
  const paidOrgs = orgs?.filter((org) => org.hasActiveSubscription) ?? [];

  return (
    <Dialog open={open} onOpenChange={(next) => !isDeleting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Delete user
          </DialogTitle>
          <DialogDescription>
            Permanently delete {userName} ({userEmail}). This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <Alert variant="destructive">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : !orgs ? (
          <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking organizations…
          </div>
        ) : orgs.length > 0 ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {orgs.length === 1 ? "1 organization" : `${orgs.length} organizations`} will also be deleted
            </AlertTitle>
            <AlertDescription>
              <p>This user is the only member, so these organizations and all their projects, tests, jobs, runs, monitors, status pages and stored reports are deleted too:</p>
              <ul className="mt-2 list-disc pl-5">
                {orgs.map((org) => (
                  <li key={org.id}>
                    {org.name}
                    {org.hasActiveSubscription && " (subscription will be cancelled)"}
                  </li>
                ))}
              </ul>
              {paidOrgs.length > 0 && (
                <p className="mt-2">Subscriptions are cancelled immediately, without a refund.</p>
              )}
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">This user is not the only member of any organization. Their organizations are kept.</p>
        )}

        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (orgs && confirmedEmail && !isDeleting) void handleDelete();
          }}
        >
          <Label htmlFor="delete-user-confirm">Type the user&apos;s email to confirm</Label>
          <Input
            id="delete-user-confirm"
            value={typedEmail}
            onChange={(event) => setTypedEmail(event.target.value)}
            placeholder={userEmail}
            autoComplete="off"
            disabled={isDeleting}
          />
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={!orgs || !confirmedEmail || isDeleting}>
            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {orgs && orgs.length > 0
              ? `Delete user and ${orgs.length} organization${orgs.length > 1 ? "s" : ""}`
              : "Delete user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
