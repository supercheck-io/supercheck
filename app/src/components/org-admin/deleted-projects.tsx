"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type DeletedProject = { id: string; name: string; deletedAt: string | null; purgeAfter: string | null };

/** Owners and admins: recently deleted projects that can still be restored. Renders nothing when there are none. */
export function DeletedProjects({ onRestored, refreshKey = 0 }: { onRestored: () => void; refreshKey?: number }) {
  // Every restore in flight, not only the latest: a second restore must not re-enable the first one's button.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000); // a restore window that ends while the page is open drops the row
    return () => clearInterval(timer);
  }, []);
  const { data: items = [], isError, refetch } = useQuery({
    queryKey: ["deleted-projects", refreshKey],
    queryFn: async (): Promise<DeletedProject[]> => {
      const res = await fetch("/api/projects/deleted");
      if (res.status === 403) return []; // not an owner or admin
      if (!res.ok) throw new Error("Failed to load deleted projects");
      const data = await res.json().catch(() => null);
      return Array.isArray(data?.projects) ? data.projects : [];
    },
    staleTime: 0,
    refetchOnMount: "always", // a deletion made elsewhere must show up when the owner returns, not the cached empty list
  });

  const restore = async (project: DeletedProject) => {
    if (inFlight.current.has(project.id)) return;
    inFlight.current.add(project.id);
    setBusy(new Set(inFlight.current));
    try {
      const res = await fetch(`/api/projects/${project.id}/restore`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) toast.error(data?.error || "Failed to restore project");
      else {
        toast.success(`Restored ${project.name}`);
        onRestored();
      }
    } catch {
      toast.error("Failed to restore project");
    }
    inFlight.current.delete(project.id);
    setBusy(new Set(inFlight.current));
    void refetch();
  };

  // The purge may be a little late; an expired row can no longer be restored.
  const restorable = items.filter((p) => !p.purgeAfter || new Date(p.purgeAfter).getTime() > now);
  if (isError) {
    return (
      <section aria-label="Recently deleted projects" className="rounded-lg border p-4">
        <p role="alert" className="text-sm text-destructive">
          Could not load recently deleted projects.{" "}
          <button type="button" className="underline" onClick={() => void refetch()}>Retry</button>
        </p>
      </section>
    );
  }
  if (restorable.length === 0) return null;
  return (
    <section aria-label="Recently deleted projects" className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Recently deleted projects</h3>
      <p className="mb-3 text-xs text-muted-foreground">Restore a project before its date, after that it is deleted permanently.</p>
      <ul className="divide-y">
        {restorable.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0 truncate text-sm font-medium">{p.name}</span>
            <span className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {p.purgeAfter ? `Restorable until ${new Date(p.purgeAfter).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}` : ""}
              </span>
              <Button size="sm" variant="outline" aria-label={`Restore ${p.name}`} disabled={busy.has(p.id)} onClick={() => void restore(p)}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Restore
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
