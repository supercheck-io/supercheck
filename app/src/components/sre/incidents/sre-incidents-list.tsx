"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Loader2,
  Plus,
  Search,
  Siren,
  X,
} from "lucide-react";
import Link from "next/link";
import { formatAge } from "@/components/sre/incidents/incident-age";
import { InfoTip } from "@/components/ui/info-tip";
import { getDisplayStatus, INCIDENT_DISPLAY_STATUSES } from "@/lib/sre/incident-status-display";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  createManualSreIncident,
  type SreIncidentListItem,
} from "@/actions/sre-incidents";
import { PageHeader } from "@/components/shared/page-header";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DataTableFacetedFilter } from "@/components/ui/data-table-faceted-filter";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { IncidentsFirstRunChecklist } from "@/components/sre/incidents/incidents-first-run-checklist";
import { pageSizeOptions, useFitPageSize } from "@/hooks/use-fit-page-size";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { UserCell } from "@/components/ui/user-cell";
import { checkRolePermissionsClient } from "@/lib/rbac/permissions-client";
import { useProjectContext } from "@/hooks/use-project-context";
import {
  getSreEvidenceGraphQueryKey,
  getSreIncidentAnalyticsQueryKey,
  getSreIncidentsQueryKey,
} from "@/lib/sre/query-keys";
import { cn } from "@/lib/utils";

type SreIncidentsListProps = {
  incidents: SreIncidentListItem[];
  loadError: string | null;
  currentUserId?: string | null;
  truncated?: boolean;
  /** False only when the project has never had an incident (shows the first-run checklist). */
  hasIncidents?: boolean;
  /** Reports which server scope the current filters need. */
  onScopeChange?: (scope: "active" | "all") => void;
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
) {
  if (filter === "all") return true;
  if (incident.status === "resolved") return false;
  if (filter === "mine") return Boolean(currentUserId) && incident.assigneeUserId === currentUserId;
  if (filter === "unassigned") return !incident.assigneeUserId;
  return true;
}

export { formatAge };

type IncidentSortKey =
  | "incidentNumber"
  | "title"
  | "severity"
  | "status"
  | "primaryServiceName"
  | "assigneeName"
  | "latestInvestigationStatus"
  | "createdAt"
  | "updatedAt";
type SortDirection = "asc" | "desc";


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

function getIncidentSortValue(
  incident: SreIncidentListItem,
  key: IncidentSortKey,
) {
  if (key === "updatedAt" || key === "createdAt") return new Date(incident[key]).getTime();
  if (key === "assigneeName") return incident.assigneeName ?? "\uffff";
  if (key === "primaryServiceName")
    return incident.primaryServiceName ?? "No service linked";
  if (key === "latestInvestigationStatus")
    return incident.latestInvestigationStatus ?? "not_started";
  return incident[key];
}

function SortableHead({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  className,
  info,
}: {
  info?: React.ReactNode;
  label: string;
  sortKey: IncidentSortKey;
  activeKey: IncidentSortKey;
  direction: SortDirection;
  onSort: (key: IncidentSortKey) => void;
  className?: string;
}) {
  const isActive = activeKey === sortKey;
  const Icon = isActive
    ? direction === "desc"
      ? ArrowDown
      : ArrowUp
    : ArrowUpDown;

  return (
    <TableHead className={className}>
      <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("-ml-3 h-8", isActive && "bg-muted font-semibold")}
        onClick={() => onSort(sortKey)}
      >
        {label}
        <Icon
          className={cn(
            "ml-2 h-4 w-4",
            isActive ? "text-primary" : "text-muted-foreground",
          )}
        />
      </Button>
      {info}
      </div>
    </TableHead>
  );
}

export function SreIncidentsList({
  incidents,
  loadError,
  currentUserId = null,
  truncated = false,
  hasIncidents = false,
  onScopeChange,
}: SreIncidentsListProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [severityFilter, setSeverityFilter] = useState<string[]>([]);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("active");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [serviceFilter, setServiceFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<IncidentSortKey>("updatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pageIndex, setPageIndex] = useState(0);
  const { bodyRef, pageSize, setPageSize } = useFitPageSize();
  const [lastPageSize, setLastPageSize] = useState(pageSize);
  // Auto-fit changes the size outside the pager, so keep the first visible row on screen.
  if (lastPageSize !== pageSize) {
    setLastPageSize(pageSize);
    setPageIndex(Math.floor((pageIndex * lastPageSize) / pageSize));
  }
  // Resolved incidents are only fetched when the All or a Status filter asks for them.
  const needsResolved = quickFilter === "all" || statusFilter.length > 0;
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
          statusFilter.length > 0 && quickFilter === "active" ? "all" : quickFilter,
          currentUserId,
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
        incident.status,
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

    return [...filtered].sort((a, b) => {
      const left = getIncidentSortValue(a, sortKey);
      const right = getIncidentSortValue(b, sortKey);
      const result =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right), undefined, {
              numeric: true,
              sensitivity: "base",
            });
      return sortDirection === "asc" ? result : -result;
    });
  }, [
    deferredSearch,
    incidents,
    quickFilter,
    currentUserId,
    severityFilter,
    serviceFilter,
    sortDirection,
    sortKey,
    statusFilter,
  ]);

  const pageCount = Math.max(1, Math.ceil(filteredIncidents.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedIncidents = filteredIncidents.slice(
    safePageIndex * pageSize,
    safePageIndex * pageSize + pageSize,
  );

  const handleSort = (key: IncidentSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(
        key === "updatedAt" || key === "createdAt" || key === "incidentNumber" ? "desc" : "asc",
      );
    }
  };

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
              setPageIndex(0);
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
                setPageIndex(0);
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
              variant={quickFilter === filter.value ? "secondary" : "ghost"}
              className="h-8"
              aria-pressed={quickFilter === filter.value}
              onClick={() => {
                setQuickFilter(filter.value);
                setPageIndex(0);
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
              setPageIndex(0);
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
              setPageIndex(0);
            }}
            options={serviceOptions}
          />
          <DataTableFacetedFilter
            title="Status"
            value={statusFilter}
            onValueChange={(values) => {
              setStatusFilter(values);
              setPageIndex(0);
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
          <div className="relative max-w-full overflow-x-auto rounded-t-lg border">
            <Table className="w-full min-w-[1000px]">
              <TableHeader>
                <TableRow>
                  <SortableHead
                    label="#"
                    sortKey="incidentNumber"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                    className="w-24"
                  />
                  <SortableHead
                    label="Title"
                    sortKey="title"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                    className="w-[360px]"
                  />
                  <SortableHead
                    label="Severity"
                    info={<InfoTip label="About severity">SEV1 is a customer-facing outage; SEV4 is minor with no customer impact.</InfoTip>}
                    sortKey="severity"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                    className="w-32"
                  />
                  <SortableHead
                    label="Status"
                    info={<InfoTip label="About status">Triggered, Acknowledged, Investigating, Fixing, Monitoring or Resolved. Hover a status on the incident page for details.</InfoTip>}
                    sortKey="status"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                    className="w-40"
                  />
                  <SortableHead
                    label="Service"
                    sortKey="primaryServiceName"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                    className="w-36"
                  />
                  <SortableHead
                    label="Assignee"
                    sortKey="assigneeName"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                    className="w-44"
                  />
                  <SortableHead
                    label="Age"
                    sortKey="createdAt"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                    className="w-24"
                  />
                  <SortableHead
                    label="AI"
                    sortKey="latestInvestigationStatus"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                    className="w-32"
                  />
                </TableRow>
              </TableHeader>
              <TableBody ref={bodyRef}>
                {pagedIncidents.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No incidents match the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedIncidents.map((incident) => (
                    <TableRow
                      key={incident.id}
                      className="h-13 cursor-pointer hover:bg-muted/50"
                      tabIndex={0}
                      onClick={() => router.push(`/incidents/${incident.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          router.push(`/incidents/${incident.id}`);
                        }
                      }}
                      aria-label={`View incident #${incident.incidentNumber}: ${incident.title}`}
                    >
                      <TableCell className="py-2.5">
                        {/* Same badge style as the UUID columns in other tables. */}
                        <code className="rounded-sm bg-muted/60 px-2 py-1 font-mono text-xs dark:bg-muted">
                          #{incident.incidentNumber}
                        </code>
                      </TableCell>
                      <TableCell className="max-w-[360px] py-2.5">
                        <span
                          className="block truncate font-medium"
                          title={incident.title}
                        >
                          {incident.title}
                        </span>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <TableBadge
                          tone={severityTones[incident.severity]}
                          compact
                          className="uppercase"
                        >
                          {incident.severity}
                        </TableBadge>
                      </TableCell>
                      <TableCell className="py-2.5">
                        {(() => {
                          const display = getDisplayStatus(
                            incident.status,
                            incident.acknowledgedAt,
                          );
                          return (
                            <TableBadge tone={display.tone} compact>
                              {display.label}
                            </TableBadge>
                          );
                        })()}
                      </TableCell>
                      <TableCell
                        className="max-w-[180px] truncate py-2.5"
                        title={
                          incident.primaryServiceName ?? "No service linked"
                        }
                      >
                        {incident.primaryServiceName ?? "No service linked"}
                      </TableCell>
                      <TableCell className="py-2.5">
                        <UserCell name={incident.assigneeName} image={incident.assigneeImage} avatarOnly />
                      </TableCell>
                      <TableCell className="py-2.5 text-sm tabular-nums">
                        <span
                          suppressHydrationWarning
                          title={formatDate(incident.createdAt)}
                        >
                          {formatAge(incident.createdAt, incident.resolvedAt ?? undefined)}
                        </span>
                      </TableCell>
                      <TableCell className="py-2.5">
                        {incident.latestInvestigationStatus ? (
                          <TableBadge
                            tone={
                              investigationStatusTones[
                                incident.latestInvestigationStatus
                              ]
                            }
                            compact
                            className="w-fit capitalize"
                          >
                            {formatStatus(incident.latestInvestigationStatus)}
                          </TableBadge>
                        ) : (
                          <TableBadge compact>Not started</TableBadge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 px-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1 text-sm text-muted-foreground">
              Total {filteredIncidents.length}{" "}
              {filteredIncidents.length === 1 ? "incident" : "incidents"}
              {truncated && " (showing latest 500)"}
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:gap-6 lg:gap-8">
              <div className="flex items-center space-x-2">
                <p className="text-sm">Rows per page</p>
                <Select
                  value={`${pageSize}`}
                  onValueChange={(value) => {
                    setPageSize(Number(value));
                    setPageIndex(0);
                  }}
                >
                  <SelectTrigger className="h-8 w-[70px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent side="top">
                    {pageSizeOptions(pageSize).map((option) => (
                      <SelectItem key={option} value={`${option}`}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex w-[100px] items-center justify-center text-sm">
                Page {safePageIndex + 1} of {pageCount}
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  className="hidden h-8 w-8 p-0 lg:flex"
                  onClick={() => setPageIndex(0)}
                  disabled={safePageIndex === 0}
                >
                  <span className="sr-only">Go to first page</span>
                  <ChevronsLeft />
                </Button>
                <Button
                  variant="outline"
                  className="h-8 w-8 p-0"
                  onClick={() => setPageIndex(Math.max(0, safePageIndex - 1))}
                  disabled={safePageIndex === 0}
                >
                  <span className="sr-only">Go to previous page</span>
                  <ChevronLeft />
                </Button>
                <Button
                  variant="outline"
                  className="h-8 w-8 p-0"
                  onClick={() =>
                    setPageIndex(Math.min(pageCount - 1, safePageIndex + 1))
                  }
                  disabled={safePageIndex >= pageCount - 1}
                >
                  <span className="sr-only">Go to next page</span>
                  <ChevronRight />
                </Button>
                <Button
                  variant="outline"
                  className="hidden h-8 w-8 p-0 lg:flex"
                  onClick={() => setPageIndex(pageCount - 1)}
                  disabled={safePageIndex >= pageCount - 1}
                >
                  <span className="sr-only">Go to last page</span>
                  <ChevronsRight />
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

    </div>
  );
}
