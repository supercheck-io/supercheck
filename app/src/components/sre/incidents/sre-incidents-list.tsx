"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { IncidentsFirstRunChecklist } from "@/components/sre/incidents/incidents-first-run-checklist";
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

/** Compact age such as 5m, 3h, 2d. */
export function formatAge(from: Date | string, to: Date | string | number = Date.now()) {
  const minutes = Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

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

const PAGE_SIZE_OPTIONS = [12, 25, 50, 100];

const severityTones: Record<SreIncidentListItem["severity"], TableBadgeTone> = {
  sev1: "danger",
  sev2: "warning",
  sev3: "warning",
  sev4: "slate",
};

const statusTones: Record<SreIncidentListItem["status"], TableBadgeTone> = {
  triggered: "danger",
  investigating: "info",
  identified: "purple",
  recommendations_ready: "info",
  user_applying_fix: "indigo",
  verifying: "warning",
  resolved: "success",
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
}: {
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
    </TableHead>
  );
}

export function SreIncidentsList({
  incidents,
  loadError,
  currentUserId = null,
}: SreIncidentsListProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    projectId,
    currentProject,
    loading: projectLoading,
    error: projectError,
  } = useProjectContext();
  const canCreate = Boolean(
    !projectLoading &&
      !projectError &&
      currentProject?.userRole &&
      checkRolePermissionsClient(currentProject.userRole, {
        sre_incident: ["create"],
      }),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [severity, setSeverity] =
    useState<SreIncidentListItem["severity"]>("sev3");
  const [summary, setSummary] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [severityFilter, setSeverityFilter] = useState<string[]>([]);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("active");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [serviceFilter, setServiceFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<IncidentSortKey>("updatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(12);
  const [isPending, startTransition] = useTransition();

  const resetForm = () => {
    setTitle("");
    setSeverity("sev3");
    setSummary("");
  };

  const handleCreateIncident = () => {
    if (!canCreate || isPending) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error("Incident title is required");
      return;
    }

    startTransition(async () => {
      const result = await createManualSreIncident({
        title: trimmedTitle,
        severity,
        summary: summary.trim() || null,
      });

      if (!result.success) {
        toast.error(result.fieldErrors?.title?.[0] ?? result.error);
        return;
      }

      toast.success(result.message);
      setDialogOpen(false);
      resetForm();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getSreIncidentsQueryKey(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: getSreIncidentAnalyticsQueryKey(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: getSreEvidenceGraphQueryKey(projectId),
        }),
      ]);
      router.push(`/incidents/${result.incident.id}`);
    });
  };

  const statusOptions = useMemo(
    () =>
      Array.from(new Set(incidents.map((incident) => incident.status))).sort(),
    [incidents],
  );

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
        (statusFilter.length === 0 || statusFilter.includes(incident.status));
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
    <div className="w-full max-w-full mt-6 space-y-4 p-2">
      <PageHeader
        title="Incidents"
        description="Track, investigate, and resolve operational incidents."
        className="mb-4 -mt-2"
        actions={
          <div
            className="flex flex-wrap items-center gap-2"
            data-testid="incident-header-actions"
          >
            {incidents.length > 0 && (
              <>
                <Button asChild type="button" variant="outline" className="h-8">
                  <Link href="/alerts">Review alerts</Link>
                </Button>
                <Button asChild type="button" variant="outline" className="h-8">
                  <Link href="/incidents/analytics">
                    <BarChart3 className="h-4 w-4" />
                    Trends
                  </Link>
                </Button>
              </>
            )}
            {projectError && (
              <p role="status" className="text-sm text-muted-foreground">
                Permissions unavailable. Refresh to try again.
              </p>
            )}
            {(canCreate || projectLoading) && (
              <Button
                type="button"
                className="h-8"
                disabled={!canCreate}
                aria-busy={projectLoading || undefined}
                title={projectLoading ? "Loading permissions..." : undefined}
                onClick={() => setDialogOpen(true)}
              >
                <Plus className="h-4 w-4" />
                New incident
              </Button>
            )}
          </div>
        }
      />

      {incidents.length > 0 && (
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
            options={Array.from(new Set([...statusOptions, "resolved"])).map(
              (value) => ({ value, label: formatStatus(value) }),
            )}
          />
        </div>
        </div>
      )}

      {incidents.length === 0 ? (
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
                    sortKey="severity"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                    className="w-32"
                  />
                  <SortableHead
                    label="Status"
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
              <TableBody>
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
                      className="cursor-pointer hover:bg-muted/50"
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
                        <TableBadge
                          tone={statusTones[incident.status]}
                          compact
                          className="capitalize"
                        >
                          {formatStatus(incident.status)}
                        </TableBadge>
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
                        {incident.assigneeName ? (
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6">
                              {incident.assigneeImage && (
                                <AvatarImage src={incident.assigneeImage} alt="" />
                              )}
                              <AvatarFallback className="text-[10px]">
                                {initials(incident.assigneeName)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate text-sm">{incident.assigneeName}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Unassigned</span>
                        )}
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
                    {PAGE_SIZE_OPTIONS.map((option) => (
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create incident</DialogTitle>
            <DialogDescription>
              Use this when an incident did not start from an alert.
              Alert-created incidents still come from the Alerts page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="manual-incident-title">Title</Label>
              <Input
                id="manual-incident-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Checkout API failures"
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-incident-severity">Severity</Label>
              <Select
                value={severity}
                onValueChange={(value) =>
                  setSeverity(value as SreIncidentListItem["severity"])
                }
              >
                <SelectTrigger id="manual-incident-severity">
                  <SelectValue placeholder="Select severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sev1">SEV1 - Critical</SelectItem>
                  <SelectItem value="sev2">SEV2 - High</SelectItem>
                  <SelectItem value="sev3">SEV3 - Medium</SelectItem>
                  <SelectItem value="sev4">SEV4 - Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-incident-summary">Initial notes</Label>
              <Textarea
                id="manual-incident-summary"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="What is known so far?"
                rows={4}
                maxLength={2000}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateIncident}
              disabled={isPending || !title.trim()}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create incident"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
