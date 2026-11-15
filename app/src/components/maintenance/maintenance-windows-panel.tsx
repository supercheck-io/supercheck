"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ListErrorState } from "@/components/shared/list-states";
import { MAINTENANCE_QUERY_KEY, useMaintenanceWindows, windowAction, type MaintenanceWindowItem } from "@/hooks/use-maintenance-windows";
import { useProjectContext } from "@/hooks/use-project-context";
import { checkRolePermissionsClient } from "@/lib/rbac/permissions-client";
import { MaintenanceWindowDialog } from "./maintenance-window-dialog";

const REPEAT_LABEL = { once: "One-off", daily: "Daily", weekly: "Weekly", monthly: "Monthly" } as const;
const SCOPE_LABEL = (w: MaintenanceWindowItem) =>
  w.scope === "project" ? "Whole project" : `${w.targets.length} ${w.scope === "services" ? "service" : "monitor"}${w.targets.length === 1 ? "" : "s"}`;
const when = (value: string | null) => (value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "-");

/** The Maintenance tab: Active, Upcoming and Past windows, with the actions the role allows. */
export function MaintenanceWindowsPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { projectId, currentProject } = useProjectContext();
  const role = currentProject?.userRole ?? "";
  const canWrite = Boolean(role && checkRolePermissionsClient(role, { monitor: ["update"] }));
  const canDelete = Boolean(role && checkRolePermissionsClient(role, { monitor: ["delete"] }));
  const windows = useMaintenanceWindows();
  const [createOpen, setCreateOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ window: MaintenanceWindowItem; action: "cancel" | "delete" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // ?new=1 (Quick Create, Cmd+K) opens the editor.
  const requested = canWrite && searchParams.get("new") === "1";
  const editorOpen = createOpen || requested;
  const setEditorOpen = (next: boolean) => {
    setCreateOpen(next);
    if (!next && requested) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("new");
      router.replace(`${pathname}?${params}`, { scroll: false });
    }
  };

  const run = async (window: MaintenanceWindowItem, action: "end" | "extend" | "cancel" | "delete", body?: unknown) => {
    setBusy(window.id);
    try {
      await windowAction(window.id, action, body);
      toast.success({ end: "Maintenance ended", extend: "Maintenance extended by 30 minutes", cancel: "Maintenance cancelled", delete: "Maintenance window deleted" }[action]);
      await queryClient.invalidateQueries({ queryKey: [...MAINTENANCE_QUERY_KEY, projectId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const groups: Array<{ title: string; items: MaintenanceWindowItem[] }> = [
    { title: "Active", items: (windows.data ?? []).filter((w) => w.state === "active") },
    { title: "Upcoming", items: (windows.data ?? []).filter((w) => w.state === "scheduled") },
    { title: "Past", items: (windows.data ?? []).filter((w) => w.state === "completed" || w.state === "cancelled") },
  ];

  return (
    <div className="space-y-4" data-testid="maintenance-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">During a window, monitors keep running but send no alerts, open no incidents and are left out of uptime.</p>
        {canWrite && (
          <Button type="button" className="h-8" onClick={() => setEditorOpen(true)}>
            <Plus className="h-4 w-4" />
            Schedule maintenance
          </Button>
        )}
      </div>
      {windows.isLoading && (
        <div className="space-y-2" aria-busy="true" aria-label="Loading maintenance windows">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {windows.error && <ListErrorState title="Maintenance windows could not be loaded" error={windows.error} onRetry={() => void windows.refetch()} />}
      {windows.data && windows.data.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center">
          <CalendarClock className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="font-medium">No maintenance scheduled</p>
          <p className="max-w-md text-sm text-muted-foreground">Schedule a window before a planned deploy or upgrade so nobody is paged for expected downtime.</p>
        </div>
      )}
      {windows.data && windows.data.length > 0 &&
        groups.filter((group) => group.items.length > 0).map((group) => (
          <section key={group.title} aria-labelledby={`mw-group-${group.title}`} className="space-y-2">
            <h3 id={`mw-group-${group.title}`} className="text-sm font-semibold">{group.title}</h3>
            <ul className="divide-y rounded-md border">
              {group.items.map((window) => (
                <li key={window.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="maintenance-row">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{window.title}</span>
                      {window.state === "active" && <Badge variant="secondary">In progress</Badge>}
                      {window.state === "cancelled" && <Badge variant="outline">Cancelled</Badge>}
                      {window.statusPageIncidentIds.length > 0 && <Badge variant="outline">On status page</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {when(window.occurrenceStartsAt)} to {when(window.occurrenceEndsAt)} · {REPEAT_LABEL[window.recurrence]} · {SCOPE_LABEL(window)} · {window.timezone}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {canWrite && window.state === "active" && (
                      <>
                        <Button size="sm" variant="outline" disabled={busy === window.id} onClick={() => void run(window, "extend", { byMinutes: 30 })}>Extend 30 min</Button>
                        <Button size="sm" variant="outline" disabled={busy === window.id} onClick={() => void run(window, "end")}>End now</Button>
                      </>
                    )}
                    {canWrite && (window.state === "scheduled" || (window.state === "active" && window.recurrence !== "once")) && (
                      <Button size="sm" variant="outline" disabled={busy === window.id} onClick={() => setConfirm({ window, action: "cancel" })}>Cancel</Button>
                    )}
                    {canDelete && window.state !== "active" && (
                      <Button size="sm" variant="outline" disabled={busy === window.id} onClick={() => setConfirm({ window, action: "delete" })}>Delete</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {editorOpen && <MaintenanceWindowDialog open onOpenChange={setEditorOpen} />}
      <AlertDialog open={confirm !== null} onOpenChange={(next) => !next && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.action === "delete" ? "Delete" : "Cancel"} “{confirm?.window.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.action === "delete"
                ? "The window and its history are removed."
                : "Alerts are no longer muted for it. A status page post is resolved as cancelled."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && void run(confirm.window, confirm.action)}>
              {confirm?.action === "delete" ? "Delete window" : "Cancel window"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** "In maintenance until 14:30" on a monitor page while a window covers it, plus a prefilled Schedule action. */
export function MonitorMaintenanceBar({ monitorId }: { monitorId: string }) {
  const { currentProject } = useProjectContext();
  const canWrite = Boolean(currentProject?.userRole && checkRolePermissionsClient(currentProject.userRole, { monitor: ["update"] }));
  const active = useMaintenanceWindows({ monitorId, state: "active" });
  const [open, setOpen] = useState(false);
  const current = active.data?.[0];
  if (!current && !canWrite) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {current && (
        <Badge variant="secondary" role="status" data-testid="maintenance-banner">
          In maintenance until {current.occurrenceEndsAt ? new Date(current.occurrenceEndsAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "-"}
        </Badge>
      )}
      {canWrite && (
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          <CalendarClock className="h-4 w-4" />
          Schedule maintenance
        </Button>
      )}
      {open && <MaintenanceWindowDialog open onOpenChange={setOpen} defaults={{ monitorId }} />}
    </div>
  );
}

/** Prefilled Schedule maintenance action for a service page. */
export function ServiceMaintenanceAction({ serviceId }: { serviceId: string }) {
  const { currentProject } = useProjectContext();
  const canWrite = Boolean(currentProject?.userRole && checkRolePermissionsClient(currentProject.userRole, { monitor: ["update"] }));
  const [open, setOpen] = useState(false);
  if (!canWrite) return null;
  return (
    <>
      <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setOpen(true)}>
        <CalendarClock className="h-4 w-4" />
        Schedule maintenance
      </Button>
      {open && <MaintenanceWindowDialog open onOpenChange={setOpen} defaults={{ serviceId }} />}
    </>
  );
}
