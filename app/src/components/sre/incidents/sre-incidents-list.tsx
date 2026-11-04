"use client";

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Search,
  Siren,
  X,
} from "lucide-react";
import Link from "next/link";
import { formatAge } from "@/components/sre/incidents/incident-age";
import { InfoTip } from "@/components/ui/info-tip";
import { getDisplayStatus, INCIDENT_DISPLAY_STATUSES } from "@/lib/sre/incident-status-display";
import { useRouter } from "next/navigation";

import { type SreIncidentListItem } from "@/actions/sre-incidents";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DataTableFacetedFilter } from "@/components/ui/data-table-faceted-filter";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { IncidentsFirstRunChecklist } from "@/components/sre/incidents/incidents-first-run-checklist";
import { DataTable } from "@/components/sre/data-table/data-table";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DateCell } from "@/components/ui/table-cells";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserCell } from "@/components/ui/user-cell";

type SreIncidentsListProps = {
  incidents: SreIncidentListItem[];
  loadError: string | null;
  currentUserId?: string | null;
  truncated?: boolean;
  /** False only when the project has never had an incident (shows the first-run checklist). */
  hasIncidents?: boolean;
  /** Reports which server scope the current filters need. */
  onScopeChange?: (scope: "active" | "all") => void;
  /** The rows are the previous scope's while the requested one loads. */
  loadingScope?: boolean;
};

type QuickFilter = "active" | "mine" | "unassigned" | "all";

const QUICK_FILTERS: Array<{ value: QuickFilter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "mine", label: "Assigned to me" },
  { value: "unassigned", label: "Unassigned" },
  { value: "all", label: "All" },
];

export function matchesQuickFilter(
  incident: Pick<SreIncidentListItem, "status" | "assigneeUserId">,
  filter: QuickFilter,
  currentUserId: string | null | undefined,
  /** A Status filter is set, so resolved incidents may match "mine" or "unassigned". */
  includeResolved = false,
) {
  if (filter === "all") return true;
  if (incident.status === "resolved" && (filter === "active" || !includeResolved)) return false;
  if (filter === "mine") return Boolean(currentUserId) && incident.assigneeUserId === currentUserId;
  if (filter === "unassigned") return !incident.assigneeUserId;
  return true;
}

export { formatAge };

const severityTones: Record<SreIncidentListItem["severity"], TableBadgeTone> = {
  sev1: "danger",
  sev2: "warning",
  sev3: "warning",
  sev4: "slate",
};

const investigationStatusTones: Record<
  NonNullable<SreIncidentListItem["latestInvestigationStatus"]>,
  TableBadgeTone
> = {
  running: "info",
  completed: "success",
  failed: "danger",
  aborted: "slate",
  timed_out: "warning",
};

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatStatus(value: string) {
  return value.replace(/_/g, " ");
}

const columns: ColumnDef<SreIncidentListItem>[] = [
  {
    accessorKey: "incidentNumber",
    header: ({ column }) => <DataTableColumnHeader column={column} title="#" />,
    cell: ({ row }) => (
      // Same badge style as the UUID columns in other tables.
      <code className="rounded-sm bg-muted/60 px-2 py-1 font-mono text-xs dark:bg-muted">
        #{row.original.incidentNumber}
      </code>
    ),
  },
  {
    accessorKey: "title",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
    cell: ({ row }) => (
      <Link
        href={`/incidents/${row.original.id}`}
        className="block max-w-[360px] truncate rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={row.original.title}
      >
        {row.original.title}
      </Link>
    ),
  },
  {
    accessorKey: "severity",
    header: ({ column }) => (
      <div className="flex items-center gap-1">
        <DataTableColumnHeader column={column} title="Severity" />
        <InfoTip label="About severity">SEV1 is a customer-facing outage; SEV4 is minor with no customer impact.</InfoTip>
      </div>
    ),
    cell: ({ row }) => (
      <TableBadge tone={severityTones[row.original.severity]} compact className="uppercase">
        {row.original.severity}
      </TableBadge>
    ),
  },
  {
    id: "status",
    // Workflow order (Triggered → Resolved), as the badges read, not the stored names.
    accessorFn: (incident) =>
      INCIDENT_DISPLAY_STATUSES.findIndex(
        (entry) => entry.value === getDisplayStatus(incident.status, incident.acknowledgedAt).value,
      ),
    header: ({ column }) => (
      <div className="flex items-center gap-1">
        <DataTableColumnHeader column={column} title="Status" />
        <InfoTip label="About status">Triggered, Acknowledged, Investigating, Fixing, Monitoring or Resolved. Hover a status on the incident page for details.</InfoTip>
      </div>
    ),
    cell: ({ row }) => {
      const display = getDisplayStatus(row.original.status, row.original.acknowledgedAt);
      return (
        <TableBadge tone={display.tone} compact>
          {display.label}
        </TableBadge>
      );
    },
  },
  {
    id: "primaryServiceName",
    accessorFn: (incident) => incident.primaryServiceName ?? "No service linked",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Service" />,
    cell: ({ getValue }) => (
      <span className="block max-w-[180px] truncate" title={getValue<string>()}>
        {getValue<string>()}
      </span>
    ),
  },
  {
    id: "assigneeName",
    // Unassigned sorts last when ascending.
    accessorFn: (incident) => incident.assigneeName ?? "\uffff",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Assignee" />,
    cell: ({ row }) => (
      <UserCell name={row.original.assigneeName} image={row.original.assigneeImage} compact emptyDash />
    ),
  },
  {
    id: "createdAt",
    accessorFn: (incident) => new Date(incident.createdAt).getTime(),
    header: ({ column }) => <DataTableColumnHeader column={column} title="Age" />,
    cell: ({ row }) => (
      <span
        className="text-sm tabular-nums"
        suppressHydrationWarning
        title={formatDate(row.original.createdAt)}
      >
        {formatAge(row.original.createdAt, row.original.resolvedAt ?? undefined)}
      </span>
    ),
  },
  {
    id: "updatedAt",
    accessorFn: (incident) => new Date(incident.updatedAt).getTime(),
    header: ({ column }) => <DataTableColumnHeader column={column} title="Updated" />,
    cell: ({ row }) => <DateCell value={row.original.updatedAt} />,
  },
  {
    id: "latestInvestigationStatus",
    accessorFn: (incident) => incident.latestInvestigationStatus ?? "not_started",
    header: ({ column }) => <DataTableColumnHeader column={column} title="AI" />,
    cell: ({ row }) => {
      const status = row.original.latestInvestigationStatus;
      return status ? (
        <TableBadge tone={investigationStatusTones[status]} compact className="w-fit capitalize">
          {formatStatus(status)}
        </TableBadge>
      ) : (
        <TableBadge compact>Not started</TableBadge>
      );
    },
  },
];

export function SreIncidentsList({
  incidents,
  loadError,
  currentUserId = null,
  truncated = false,
  hasIncidents = false,
  onScopeChange,
  loadingScope = false,
}: SreIncidentsListProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [severityFilter, setSeverityFilter] = useState<string[]>([]);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("active");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [serviceFilter, setServiceFilter] = useState<string[]>([]);
  // Resolved incidents are only fetched when the All or a Status filter asks for them.
  const needsResolved = quickFilter === "all" || statusFilter.length > 0;
  // Picking a status overrides the default Active view so "Resolved" is reachable; the chips show that.
  const effectiveQuickFilter: QuickFilter =
    statusFilter.length > 0 && quickFilter === "active" ? "all" : quickFilter;
  useEffect(() => {
    onScopeChange?.(needsResolved ? "all" : "active");
  }, [needsResolved, onScopeChange]);
  const serviceOptions = useMemo(
    () =>
      Array.from(
        new Map(
          incidents.map((incident) => [
            incident.primaryServiceId ?? "unlinked",
            {
              value: incident.primaryServiceId ?? "unlinked",
              label: incident.primaryServiceName ?? "No service linked",
            },
          ]),
        ).values(),
      ).sort((a, b) => a.label.localeCompare(b.label)),
    [incidents],
  );

  const filteredIncidents = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    const filtered = incidents.filter((incident) => {
      const matchesSeverity =
        severityFilter.length === 0 ||
        severityFilter.includes(incident.severity);
      const matchesStatus =
        // Picking a status overrides the default Active view so "Resolved" is reachable.
        matchesQuickFilter(
          incident,
          effectiveQuickFilter,
          currentUserId,
          statusFilter.length > 0,
        ) &&
        (statusFilter.length === 0 ||
          statusFilter.includes(
            getDisplayStatus(incident.status, incident.acknowledgedAt).value,
          ));
      const matchesService =
        serviceFilter.length === 0 ||
        serviceFilter.includes(incident.primaryServiceId ?? "unlinked");
      const searchable = [
        incident.id,
        String(incident.incidentNumber),
        incident.title,
        incident.primaryServiceName ?? "No service linked",
        incident.assigneeName ?? "unassigned",
        incident.severity,
        getDisplayStatus(incident.status, incident.acknowledgedAt).label,
        incident.latestInvestigationStatus ?? "not started",
      ]
        .join(" ")
        .toLowerCase();

      return (
        matchesSeverity &&
        matchesStatus &&
        matchesService &&
        (!query || searchable.includes(query))
      );
    });

    // Newest activity first; a column header click overrides it in the table.
    return filtered.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [
    deferredSearch,
    incidents,
    effectiveQuickFilter,
    currentUserId,
    severityFilter,
    serviceFilter,
    statusFilter,
  ]);

  if (loadError) {
    return (
      <DashboardEmptyState
        className="min-h-[260px]"
        title="Incidents unavailable"
        description={loadError}
        icon={<Siren className="h-10 w-10" />}
      />
    );
  }

  return (
    <div className="w-full max-w-full space-y-4">

      {(incidents.length > 0 || hasIncidents) && (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="incident-toolbar"
        >
        <div className="relative w-full sm:w-[250px]">
          <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            aria-label="Search incidents"
            placeholder="Search incidents..."
            className="h-8 pl-8 pr-8"
          />
          {search.length > 0 && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setSearch("");
              }}
              aria-label="Clear incident search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div
          role="group"
          aria-label="Quick filters"
          className="flex flex-wrap items-center gap-1"
        >
          {QUICK_FILTERS.map((filter) => (
            <Button
              key={filter.value}
              type="button"
              size="sm"
              variant={effectiveQuickFilter === filter.value ? "secondary" : "ghost"}
              className="h-8"
              aria-pressed={effectiveQuickFilter === filter.value}
              onClick={() => {
                setQuickFilter(filter.value);
              }}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DataTableFacetedFilter
            title="Severity"
            value={severityFilter}
            onValueChange={(values) => {
              setSeverityFilter(values);
            }}
            options={["sev1", "sev2", "sev3", "sev4"].map((value) => ({
              value,
              label: value.toUpperCase(),
            }))}
          />
          <DataTableFacetedFilter
            title="Service"
            value={serviceFilter}
            onValueChange={(values) => {
              setServiceFilter(values);
            }}
            options={serviceOptions}
          />
          <DataTableFacetedFilter
            title="Status"
            value={statusFilter}
            onValueChange={(values) => {
              setStatusFilter(values);
            }}
            options={INCIDENT_DISPLAY_STATUSES.map(({ value, label }) => ({
              value,
              label,
            }))}
          />
        </div>
        </div>
      )}

      {incidents.length === 0 && !hasIncidents ? (
        <IncidentsFirstRunChecklist />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={filteredIncidents}
            isLoading={loadingScope && filteredIncidents.length === 0}
            onRowClick={(row) => router.push(`/incidents/${row.original.id}`)}
            initialColumnVisibility={{}}
            entityLabel={`incidents${truncated ? " (from the latest 500)" : ""}`}
            skeletonColumns={9}
          />
        </>
      )}

    </div>
  );
}
