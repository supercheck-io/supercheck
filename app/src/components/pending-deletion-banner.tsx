"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DeletionState = { pending: boolean; purgeAfter: string | null; canCancel: boolean };

export function deletionCountdown(purgeAfter: string | null, now = Date.now()): string {
  if (!purgeAfter) return "soon";
  const ms = new Date(purgeAfter).getTime() - now;
  if (ms <= 0) return "shortly";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return `in ${hours} hour${hours === 1 ? "" : "s"}`;
}

async function fetchState(organizationId: string): Promise<DeletionState | null> {
  const res = await fetch(`/api/organizations/${organizationId}/deletion`);
  if (!res.ok) return null;
  return (await res.json())?.deletion ?? null;
}

/** Shown to every member while the organization is pending deletion; only the owner gets the cancel button. */
export function PendingDeletionBanner({ organizationId, pending, isOwner }: { organizationId: string; pending: boolean; isOwner: boolean }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // The state loads in the browser after hydration, so the first render never prints a date.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000); // a page left open keeps an accurate countdown
    return () => clearInterval(timer);
  }, []);
  const { data } = useQuery({ queryKey: ["org-deletion-state", organizationId], queryFn: () => fetchState(organizationId), enabled: pending, staleTime: 60_000 });
  // The fetched state wins once it is loaded (another owner may have cancelled); the prop covers the first render.
  if (!(data ? data.pending : pending)) return null;

  const cancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch(`/api/organizations/${organizationId}/cancel-deletion`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        toast.error(body?.error || "Could not cancel the deletion");
        setCancelling(false);
        return;
      }
      if (body.billing === "ended") toast.success("Deletion cancelled. The paid period had already ended, so subscribe again to keep using paid features.");
      else if (body.billing === "failed") toast.success("Deletion cancelled. Renewal could not be re-enabled; check the billing portal.");
      else toast.success("Deletion cancelled");
      window.location.reload();
    } catch {
      toast.error("Could not cancel the deletion");
      setCancelling(false);
    }
  };

  const canCancel = isOwner && data?.canCancel !== false;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
      <span className="flex items-center gap-2">
        <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          This organization is scheduled for deletion {deletionCountdown(data?.purgeAfter ?? null, now)}
          {data?.purgeAfter ? ` (${new Date(data.purgeAfter).toLocaleDateString()})` : ""}. It is read-only until then.
          {!isOwner && " Only an owner can cancel the deletion."}
        </span>
      </span>
      {canCancel && (
        <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
          Cancel deletion
        </Button>
      )}
      <Dialog open={confirmOpen} onOpenChange={(next) => !cancelling && setConfirmOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel the deletion?</DialogTitle>
            <DialogDescription>The organization returns to normal. Schedules and monitors resume.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={cancelling}>
              Keep deletion
            </Button>
            <Button onClick={() => void cancel()} disabled={cancelling}>
              Cancel deletion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
