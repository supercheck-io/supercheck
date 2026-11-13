"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ADMIN_DELETION_JOBS_QUERY_KEY } from "@/hooks/use-deletion-jobs";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AdminOrganization } from "@/hooks/use-super-admin";

export const MIN_PURGE_REASON = 10;

/** Super admin: organizations pending deletion (early purge for legal erasure). Unfinished purges are listed by DeletionJobsTable. */
export function DeletionPanel({ organizations, isLoading = false, error = null, onRetry, onChanged }: {
  organizations: AdminOrganization[]; isLoading?: boolean; error?: Error | null; onRetry?: () => void; onChanged: () => void;
}) {
  const [target, setTarget] = useState<AdminOrganization | null>(null);
  const [reason, setReason] = useState("");
  const [typedId, setTypedId] = useState("");
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const pending = organizations.filter((o) => o.deletionRequestedAt);

  const reasonOk = reason.trim().length >= MIN_PURGE_REASON;
  const confirmed = !!target && reasonOk && typedId.trim() === target.id;

  const purge = async () => {
    if (!target || !confirmed || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/organizations/${target.id}/purge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), confirmOrganizationId: target.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || "Failed to purge organization");
      } else {
        toast.success("Purge started");
        setTarget(null);
        setReason("");
        setTypedId("");
        onChanged();
        void queryClient.invalidateQueries({ queryKey: ADMIN_DELETION_JOBS_QUERY_KEY });
      }
    } catch {
      toast.error("Failed to purge organization");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-6">
      <section aria-label="Organizations pending deletion" className="space-y-2">
        <h3 className="text-sm font-semibold">Organizations pending deletion</h3>
        {error && pending.length === 0 ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load organizations.{" "}
            {onRetry && <button type="button" className="underline" onClick={onRetry}>Retry</button>}
          </p>
        ) : isLoading && pending.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">Loading...</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {pending.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{o.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    Purge on {o.deletionPurgeAfter ? new Date(o.deletionPurgeAfter).toLocaleString() : "unknown"}
                  </span>
                </span>
                <Button size="sm" variant="destructive" aria-label={`Purge ${o.name} now`} onClick={() => { setTarget(o); setReason(""); setTypedId(""); }}>
                  Purge now
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={!!target} onOpenChange={(next) => !busy && !next && setTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Purge {target?.name} now</DialogTitle>
            <DialogDescription>
              Skips the grace window and permanently deletes the organization and its data. This cannot be undone. The reason is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="purge-reason">Reason (at least {MIN_PURGE_REASON} characters)</Label>
            <Textarea id="purge-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="purge-org-id">Type the organization ID to confirm</Label>
            <Input id="purge-org-id" value={typedId} onChange={(e) => setTypedId(e.target.value)} placeholder={target?.id} autoComplete="off" disabled={busy} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={() => void purge()} disabled={!confirmed || busy}>Purge organization</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
