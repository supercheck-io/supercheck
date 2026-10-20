"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useOrganizations } from "@/hooks/use-organizations";
import { clearProjectsCache } from "@/hooks/use-project-context";
import { announceProjectChange, reloadProjectContext } from "@/lib/project-navigation";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function LeaveOrganizationDialog() {
  const { activeOrganization } = useOrganizations();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  if (!activeOrganization) return null;
  const isOwner = activeOrganization.role === "org_owner";
  const leave = async () => {
    setPending(true);
    try {
      const response = await fetch("/api/organizations/leave", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: activeOrganization.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to leave organization");
      announceProjectChange();
      reloadProjectContext(clearProjectsCache);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to leave organization");
      setPending(false);
    }
  };
  return (
    <>
      <DropdownMenuItem onSelect={(event) => { event.preventDefault(); setOpen(true); }}>
        Leave organization
      </DropdownMenuItem>
      <AlertDialog open={open} onOpenChange={value => { if (!pending) setOpen(value); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {activeOrganization.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {isOwner
                ? "Organization owners must transfer ownership or delete the organization before leaving."
                : "You will lose access to this organization's projects. An administrator will need to invite you again to rejoin."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{isOwner ? "Close" : "Cancel"}</AlertDialogCancel>
            {!isOwner && <AlertDialogAction disabled={pending} onClick={event => { event.preventDefault(); void leave(); }}>
              {pending ? "Leaving…" : "Leave organization"}
            </AlertDialogAction>}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
