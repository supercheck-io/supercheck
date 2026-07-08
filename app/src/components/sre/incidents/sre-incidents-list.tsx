"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Loader2,
  Plus,
  Search,
  Siren,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  createManualSreIncident,
  type SreIncidentListItem,
} from "@/actions/sre-incidents";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { Badge } from "@/components/ui/badge";
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
import { UUIDField } from "@/components/ui/uuid-field";
import { cn } from "@/lib/utils";

type SreIncidentsListProps = {
  incidents: SreIncidentListItem[];
  loadError: string | null;
};

type IncidentSortKey =
  | "id"
  | "incidentNumber"
  | "title"
  | "severity"
  | "status"
  | "primaryServiceName"
  | "latestInvestigationStatus"
  | "evidenceCount"
  | "updatedAt";
type SortDirection = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [12, 25, 50, 100];

const severityClasses: Record<SreIncidentListItem["severity"], string> = {
  sev1: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
  sev2: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300",
  sev3: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  sev4: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
};

const statusClasses: Record<SreIncidentListItem["status"], string> = {
  triggered:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
  investigating:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300",
  identified:
    "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900/60 dark:bg-purple-950/40 dark:text-purple-300",
  recommendations_ready:
    "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-300",
  user_applying_fix:
    "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300",
  verifying:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  resolved:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
};

const investigationStatusClasses: Record<
  NonNullable<SreIncidentListItem["latestInvestigationStatus"]>,
  string
> = {
  running:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300",
  completed:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  failed:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
  aborted:
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
  timed_out:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
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
  if (key === "updatedAt") return new Date(incident.updatedAt).getTime();
  if (key === "primaryServiceName")
    return incident.primaryServiceName ?? "Unmapped";
  if (key === "latestInvestigationStatus")
    return incident.latestInvestigationStatus ?? "not_started";
  if (key === "id") return incident.id;
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
}: SreIncidentsListProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [severity, setSeverity] =
    useState<SreIncidentListItem["severity"]>("sev3");
  const [summary, setSummary] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
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
      router.push(`/incidents/${result.incident.id}`);
      router.refresh();
    });
  };

  const statusOptions = useMemo(
    () =>
      Array.from(new Set(incidents.map((incident) => incident.status))).sort(),
    [incidents],
  );

  const filteredIncidents = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    const filtered = incidents.filter((incident) => {
      const matchesSeverity =
        severityFilter === "all" || incident.severity === severityFilter;
      const matchesStatus =
        statusFilter === "all" || incident.status === statusFilter;
      const searchable = [
        incident.id,
        String(incident.incidentNumber),
        incident.title,
        incident.primaryServiceName ?? "Unmapped",
        incident.severity,
        incident.status,
        incident.latestInvestigationStatus ?? "not started",
      ]
        .join(" ")
        .toLowerCase();

      return (
        matchesSeverity &&
        matchesStatus &&
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
    severityFilter,
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
        key === "updatedAt" || key === "incidentNumber" ? "desc" : "asc",
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
    <div className="w-full max-w-full space-y-4 overflow-x-hidden p-2">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-2xl font-semibold">Incidents</h2>
          <p className="max-w-[560px] text-sm text-muted-foreground">
            Track response status, investigation state, evidence, and service ownership.
          </p>
        </div>
        {incidents.length > 0 && (
          <div className="flex w-full flex-wrap items-center justify-start gap-2 xl:w-auto xl:justify-end">
            <div className="relative w-full sm:w-[300px] xl:w-[360px]">
              <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPageIndex(0);
                }}
                placeholder="Filter by all available fields..."
                className="h-8 pl-8 pr-8"
              />
            </div>
            <Select
              value={severityFilter}
              onValueChange={(value) => {
                setSeverityFilter(value);
                setPageIndex(0);
              }}
            >
              <SelectTrigger className="h-8 w-[150px]">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="sev1">SEV1</SelectItem>
                <SelectItem value="sev2">SEV2</SelectItem>
                <SelectItem value="sev3">SEV3</SelectItem>
                <SelectItem value="sev4">SEV4</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value);
                setPageIndex(0);
              }}
            >
              <SelectTrigger className="h-8 w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statusOptions.map((status) => (
                  <SelectItem key={status} value={status}>
                    {formatStatus(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" className="h-8" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              New incident
            </Button>
          </div>
        )}
      </div>

      {incidents.length === 0 ? (
        <DashboardEmptyState
          className="min-h-[260px]"
          title="No incidents yet"
          description="Create one manually, or create one from an alert signal when it needs investigation."
          icon={<Siren className="h-10 w-10" />}
          action={
            <Button type="button" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              New incident
            </Button>
          }
        />
      ) : (
        <>
          <div className="w-full max-w-full overflow-hidden rounded-t-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead
                    label="ID"
                    sortKey="id"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                    className="w-32"
                  />
                  <SortableHead
                    label="Incident"
                    sortKey="title"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                    className="w-[420px]"
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
                    label="Investigation"
                    sortKey="latestInvestigationStatus"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                    className="w-36"
                  />
                  <SortableHead
                    label="Evidence"
                    sortKey="evidenceCount"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                    className="w-32"
                  />
                  <SortableHead
                    label="Updated"
                    sortKey="updatedAt"
                    activeKey={sortKey}
                    direction={sortDirection}
                    onSort={handleSort}
                    className="w-44"
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
                      className="h-[72px] cursor-pointer hover:bg-muted/50"
                      tabIndex={0}
                      onClick={() => router.push(`/incidents/${incident.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          router.push(`/incidents/${incident.id}`);
                        }
                      }}
                      aria-label={`View incident ${incident.id}: ${incident.title}`}
                    >
                      <TableCell className="py-2.5" onClick={(event) => event.stopPropagation()}>
                        <UUIDField value={incident.id} maxLength={8} />
                      </TableCell>
                      <TableCell className="max-w-[420px] py-2.5">
                        <span
                          className="block truncate font-medium"
                          title={incident.title}
                        >
                          {incident.title}
                        </span>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Badge
                          variant="outline"
                          className={cn(
                            "uppercase",
                            severityClasses[incident.severity],
                          )}
                        >
                          {incident.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Badge
                          variant="outline"
                          className={cn(
                            "capitalize",
                            statusClasses[incident.status],
                          )}
                        >
                          {formatStatus(incident.status)}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="max-w-[180px] truncate py-2.5"
                        title={incident.primaryServiceName ?? "Unmapped"}
                      >
                        {incident.primaryServiceName ?? "Unmapped"}
                      </TableCell>
                      <TableCell className="py-2.5">
                        {incident.latestInvestigationStatus ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              "w-fit capitalize",
                              investigationStatusClasses[
                                incident.latestInvestigationStatus
                              ],
                            )}
                          >
                            {formatStatus(incident.latestInvestigationStatus)}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Not started</Badge>
                        )}
                      </TableCell>
                      <TableCell className="py-2.5">
                        {incident.evidenceCount}
                      </TableCell>
                      <TableCell className="py-2.5">
                        <div className="inline-flex items-center gap-1 whitespace-nowrap text-sm">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          <span suppressHydrationWarning>
                            {formatDate(incident.updatedAt)}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 px-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1 text-sm text-muted-foreground">
              Total {filteredIncidents.length} incidents
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
