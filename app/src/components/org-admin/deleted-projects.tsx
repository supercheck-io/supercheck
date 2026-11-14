"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Project } from "./project-columns";

type DeletedProject = { id: string; name: string; description: string | null; createdAt: string | null; deletedAt: string | null; purgeAfter: string | null };

/** Restore deadline as the owner reads it: date, time and time zone (the window ends at an exact moment). */
export const formatRestoreDeadline = (purgeAfter: string) =>
  new Date(purgeAfter).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

/**
 * Owners and admins: recently deleted projects that can still be restored, as rows for the projects table, plus the
 * restore action. Rows whose window has ended drop out while the page stays open.
 */
export function useDeletedProjects({ enabled, onRestored, refreshKey = 0 }: { enabled: boolean; onRestored: () => void; refreshKey?: number }) {
  // Every restore in flight, not only the latest: a second restore must not re-enable the first one's button.
  const [restoring, setRestoring] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const [now, setNow] = useState(() => Date.now());
  const { data: items = [], isError, refetch } = useQuery({
    queryKey: ["deleted-projects", refreshKey],
    queryFn: async (): Promise<DeletedProject[]> => {
      const res = await fetch("/api/projects/deleted");
      if (res.status === 403) return []; // not an owner or admin
      if (!res.ok) throw new Error("Failed to load deleted projects");
      const data = await res.json().catch(() => null);
      return Array.isArray(data?.projects) ? data.projects : [];
    },
    enabled,
    staleTime: 0,
    refetchOnMount: "always", // a deletion made elsewhere must show up when the owner returns, not the cached empty list
  });

  // Re-render once, when the earliest restore window ends (not on a timer: every page re-render would reset the table's page).
  const nextExpiry = Math.min(...items.map((p) => (p.purgeAfter ? new Date(p.purgeAfter).getTime() : Infinity)).filter((t) => t > now));
  useEffect(() => {
    if (!enabled || !Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(nextExpiry - Date.now() + 1_000, 2_147_000_000));
    return () => clearTimeout(timer);
  }, [enabled, nextExpiry]);

  const restore = async (project: Pick<Project, "id" | "name">) => {
    if (inFlight.current.has(project.id)) return;
    inFlight.current.add(project.id);
    setRestoring(new Set(inFlight.current));
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
    await refetch(); // keep the button disabled until the restored row has left the list
    inFlight.current.delete(project.id);
    setRestoring(new Set(inFlight.current));
  };

  // The purge may be a little late; an expired row can no longer be restored.
  // Memoized: a new array each render would make the projects table reset to its first page.
  const rows = useMemo<Project[]>(() => (enabled ? items : [])
    .filter((p) => !p.purgeAfter || new Date(p.purgeAfter).getTime() > now)
    .map((p) => ({
      id: p.id, name: p.name, description: p.description ?? undefined, createdAt: p.createdAt ?? p.deletedAt ?? "",
      membersCount: 0, isDefault: false, deleted: { until: p.purgeAfter },
    })), [enabled, items, now]);
  return { rows, isError: enabled && isError, refetch, restore, restoring };
}
