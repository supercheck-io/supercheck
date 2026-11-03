"use client";

import { useState } from "react";
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
import { reloadProjectContext } from "@/lib/project-navigation";
import { clearProjectsCache } from "@/hooks/use-project-context";

interface DeleteOrganizationButtonProps {
  organizationId: string;
  organizationName: string;
}

/** Owner-only: permanently deletes the organization after the name is typed. */
export function DeleteOrganizationButton({ organizationId, organizationName }: DeleteOrganizationButtonProps) {
  const [open, setOpen] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const confirmed = typedName.trim() === organizationName;

  const handleDelete = async () => {
    if (!confirmed || isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/organizations/${organizationId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmOrganizationId: organizationId }),
      });
      const data = await res.json().catch(() => null);
      if (!data) {
        toast.error("No response from the server. The deletion may still be running; reload the page before retrying.");
        setIsDeleting(false);
        return;
      }
      if (!data.success) {
        toast.error(data.error || "Failed to delete organization");
        setIsDeleting(false);
        return;
      }
      toast.success("Organization deleted");
      // Drop cached projects and queries of the deleted organization, then reload (stays disabled meanwhile).
      reloadProjectContext(clearProjectsCache);
      return;
    } catch {
      toast.error("Failed to delete organization");
    }
    setIsDeleting(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
        onClick={() => {
          setTypedName("");
          setOpen(true);
        }}
        title="Delete organization"
        aria-label="Delete organization"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={(next) => !isDeleting && setOpen(next)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              Delete organization
            </DialogTitle>
            <DialogDescription>Permanently delete {organizationName}. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Everything in this organization is deleted</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 list-disc pl-5">
                <li>All projects, tests, jobs, runs, monitors, status pages and stored reports</li>
                <li>Every member loses access</li>
                <li>A subscription that is still active is cancelled immediately, without a refund</li>
              </ul>
            </AlertDescription>
          </Alert>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void handleDelete();
            }}
          >
            <Label htmlFor="delete-org-confirm">Type the organization name to confirm</Label>
            <Input
              id="delete-org-confirm"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              placeholder={organizationName}
              autoComplete="off"
              disabled={isDeleting}
            />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={!confirmed || isDeleting}>
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete organization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
