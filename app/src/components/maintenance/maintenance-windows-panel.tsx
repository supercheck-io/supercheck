"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, MoreHorizontal, Plus, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { DataTableFacetedFilter } from "@/components/ui/data-table-faceted-filter";
import { DataTable } from "@/components/sre/data-table/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { NAV } from "@/lib/nav-areas";
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

const EXPLAINER = "During a window, monitors keep running but send no alerts, open no incidents and are left out of uptime.";
const STATE_BADGE: Record<MaintenanceWindowItem["state"], { label: string; tone: TableBadgeTone }> = {
  active: { label: "In progress", tone: "purple" },
  scheduled: { label: "Scheduled", tone: "info" },
  completed: { label: "Completed", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "slate" },
};
// Live windows first, then upcoming, then past; the API order is kept within each group.
const STATE_RANK: Record<MaintenanceWindowItem["state"], number> = { active: 0, scheduled: 1, completed: 2, cancelled: 2 };
const byState = (rows: MaintenanceWindowItem[]) => [...rows].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]);
const STATUS_OPTIONS = Object.entries(STATE_BADGE).map(([value, { label }]) => ({ value, label }));

type WindowRunner = (window: MaintenanceWindowItem, action: "end" | "extend" | "cancel" | "delete", body?: unknown) => Promise<void>;
type TableMeta = { canWrite: boolean; canDelete: boolean; busy: string | null; run: WindowRunner; confirm: (window: MaintenanceWindowItem, action: "cancel" | "delete") => void };

function RowActions({ window, meta }: { window: MaintenanceWindowItem; meta: TableMeta }) {
  const canCancel = meta.canWrite && (window.state === "scheduled" || (window.state === "active" && window.recurrence !== "once"));
  const canEnd = meta.canWrite && window.state === "active";
  const canRemove = meta.canDelete && window.state !== "active";
  if (!canEnd && !canCancel && !canRemove) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="flex h-8 w-8 p-0 data-[state=open]:bg-muted" aria-label={`Actions for ${window.title}`} disabled={meta.busy === window.id}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[160px]">
        {canEnd && <DropdownMenuItem onClick={() => void meta.run(window, "extend", { byMinutes: 30 })}>Extend 30 min</DropdownMenuItem>}
        {canEnd && <DropdownMenuItem onClick={() => void meta.run(window, "end")}>End now</DropdownMenuItem>}
        {canCancel && <DropdownMenuItem onClick={() => meta.confirm(window, "cancel")}>Cancel</DropdownMenuItem>}
        {canRemove && (canEnd || canCancel) && <DropdownMenuSeparator />}
        {canRemove && <DropdownMenuItem className="text-destructive" onClick={() => meta.confirm(window, "delete")}>Delete</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const columns: ColumnDef<MaintenanceWindowItem>[] = [
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) => (
      <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="maintenance-row">
        <span className="truncate font-medium">{row.original.title}</span>
        {row.original.statusPageIncidentIds.length > 0 && <TableBadge tone="info" compact>On status page</TableBadge>}
      </div>
    ),
  },
  {
    id: "state",
    accessorFn: (w) => w.state,
    header: "Status",
    cell: ({ row }) => <TableBadge tone={STATE_BADGE[row.original.state].tone}>{STATE_BADGE[row.original.state].label}</TableBadge>,
    filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
  },
  {
    id: "window",
    accessorFn: (w) => w.occurrenceStartsAt ?? "",
    header: "Window",
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-sm tabular-nums">
        {when(row.original.occurrenceStartsAt)} to {when(row.original.occurrenceEndsAt)}
      </span>
    ),
  },
  { id: "repeats", accessorFn: (w) => REPEAT_LABEL[w.recurrence], header: "Repeats" },
  { id: "scope", accessorFn: SCOPE_LABEL, header: "Scope" },
  { accessorKey: "timezone", header: "Timezone" },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    enableSorting: false,
    cell: ({ row, table }) => (
      <div className="flex justify-end">
        <RowActions window={row.original} meta={table.options.meta as unknown as TableMeta} />
      </div>
    ),
  },
];

/** The Maintenance tab: every window in one table, with the actions the role allows. `tabs` is the page's tab switcher. */
export function MaintenanceWindowsPanel({ tabs }: { tabs?: ReactNode } = {}) {
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

  const run: WindowRunner = async (window, action, body) => {
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

  const isEmpty = Boolean(windows.data && windows.data.length === 0);
  const sortedWindows = useMemo(() => byState(windows.data ?? []), [windows.data]);
  const scheduleButton = canWrite ? (
    <Button type="button" onClick={() => setEditorOpen(true)}>
      <Plus className="mr-2 h-4 w-4" />
      Schedule maintenance
    </Button>
  ) : null;

  return (
    <div className="space-y-4" data-testid="maintenance-panel">
      <PageHeader
        title="Monitors"
        icon={NAV.monitors.icon}
        tone={NAV.monitors.tone}
        description={isEmpty ? undefined : EXPLAINER}
        actions={
          <>
            {tabs}
            {!isEmpty && scheduleButton}
          </>
        }
      />
      {windows.isLoading && (
        <div className="space-y-2" aria-busy="true" aria-label="Loading maintenance windows">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {windows.error && <ListErrorState title="Maintenance windows could not be loaded" error={windows.error} onRetry={() => void windows.refetch()} />}
      {isEmpty && (
        <DashboardEmptyState
          className="min-h-[420px]"
          title="No maintenance scheduled"
          description={`${EXPLAINER} Schedule a window before a planned deploy or upgrade so nobody is paged for expected downtime.`}
          icon={<CalendarClock className="h-10 w-10" />}
          action={scheduleButton ?? undefined}
        />
      )}
      {windows.data && windows.data.length > 0 && (
        <DataTable
          columns={columns}
          data={sortedWindows}
          entityLabel="maintenance windows"
          emptyMessage="No maintenance windows match."
          initialColumnVisibility={{}}
          meta={{
            globalFilterColumns: ["title", "scope", "timezone"],
            canWrite,
            canDelete,
            busy,
            run,
            confirm: (window: MaintenanceWindowItem, action: "cancel" | "delete") => setConfirm({ window, action }),
          }}
          renderToolbar={(table) => (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                  placeholder="Search maintenance..."
                  aria-label="Search maintenance windows"
                  value={(table.getState().globalFilter as string) ?? ""}
                  onChange={(event) => table.setGlobalFilter(event.target.value)}
                  className="h-8 w-[300px] pl-8"
                  data-testid="maintenance-search"
                />
              </div>
              {table.getColumn("state") && <DataTableFacetedFilter column={table.getColumn("state")} title="Status" options={STATUS_OPTIONS} />}
            </div>
          )}
        />
      )}
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
  // Alerts stay muted until the last of the overlapping windows ends.
  const current = active.data?.reduce<MaintenanceWindowItem | undefined>(
    (latest, window) => (!latest || (window.occurrenceEndsAt ?? "") > (latest.occurrenceEndsAt ?? "") ? window : latest),
    undefined,
  );
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
