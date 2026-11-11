"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { TableBadge } from "@/components/ui/table-badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AdminOrganization } from "@/hooks/use-super-admin";

type DeletionJob = {
  id: string;
  scope: string;
  targetId: string;
  organizationId: string | null;
  state: string;
  phase: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
};

export const MIN_PURGE_REASON = 10;

/** Super admin: organizations pending deletion (early purge for legal erasure) and unfinished background purges. */
export function DeletionPanel({ organizations, onChanged }: { organizations: AdminOrganization[]; onChanged: () => void }) {
  const [target, setTarget] = useState<AdminOrganization | null>(null);
  const [reason, setReason] = useState("");
  const [typedId, setTypedId] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = organizations.filter((o) => o.deletionRequestedAt);

  const { data: jobs = null, refetch } = useQuery({
    queryKey: ["super-admin", "deletion-jobs"],
    queryFn: async (): Promise<DeletionJob[]> => {
      const res = await fetch("/api/admin/deletion-jobs").catch(() => null);
      const data = await res?.json().catch(() => null);
      return res?.ok && Array.isArray(data?.data) ? data.data : [];
    },
    staleTime: 0,
  });
  const loadJobs = refetch;

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
        void loadJobs();
      }
    } catch {
      toast.error("Failed to purge organization");
    }
    setBusy(false);
  };

  const retry = async (id: string) => {
    const res = await fetch("/api/admin/deletion-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => null);
    if (res?.ok) {
      toast.success("Retry queued");
      void loadJobs();
    } else toast.error("Only a failed deletion job can be retried");
  };

  return (
    <div className="space-y-6">
      <section aria-label="Organizations pending deletion" className="space-y-2">
        <h3 className="text-sm font-semibold">Organizations pending deletion</h3>
        {pending.length === 0 ? (
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
                <Button size="sm" variant="destructive" onClick={() => { setTarget(o); setReason(""); setTypedId(""); }}>
                  Purge now
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Deletion jobs" className="space-y-2">
        <h3 className="text-sm font-semibold">Unfinished deletion jobs</h3>
        {jobs === null ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <TableBadge tone={j.state === "failed" ? "danger" : "info"}>{j.state}</TableBadge>
                    <span className="font-medium">{j.scope}</span>
                    <span className="font-mono text-xs text-muted-foreground">{j.targetId.slice(0, 8)}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {j.phase ?? "queued"}, attempts {j.attempts}
                    {j.lastError ? `, ${j.lastError}` : ""}
                  </span>
                </span>
                {j.state === "failed" && (
                  <Button size="sm" variant="outline" onClick={() => void retry(j.id)}>
                    Retry
                  </Button>
                )}
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
            <Textarea id="purge-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
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
