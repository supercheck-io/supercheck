"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Info,
  Plus,
  Search,
  Siren,
} from "lucide-react";
import { toast } from "sonner";

import { createSreIncidentFromAlert } from "@/actions/sre-incidents";
import type { AlertHistory } from "@/components/alerts/schema";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { Button } from "@/components/ui/button";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type SreAlertSeverity = "sev1" | "sev2" | "sev3" | "sev4";

type DerivedSreAlert = {
  id: string;
  fingerprint: string;
  targetName: string;
  source: string;
  serviceHint: string;
  type: string;
  message: string;
  severity: SreAlertSeverity;
  timestamp: string;
  duplicateCount: number;
};

type SreAlertsViewProps = {
  alerts: AlertHistory[];
  isLoading: boolean;
};

type AlertSortKey =
  | "targetName"
  | "serviceHint"
  | "type"
  | "duplicateCount"
  | "severity"
  | "source"
  | "timestamp";
type SortDirection = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [12, 25, 50, 100];

const severityTones: Record<SreAlertSeverity, TableBadgeTone> = {
  sev1: "danger",
  sev2: "warning",
  sev3: "warning",
  sev4: "slate",
};

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function isActionableSreSignal(alert: AlertHistory) {
  if (alert.status !== "sent") {
    return false;
  }

  const normalizedType = alert.type.toLowerCase();
  const normalizedMessage = alert.message.toLowerCase();
  return !(
    normalizedType.includes("recovery") ||
    normalizedType.includes("success") ||
    normalizedType.includes("resolved") ||
    normalizedMessage.includes("completed successfully")
  );
}

function deriveSeverity(alert: AlertHistory): SreAlertSeverity {
  const type = alert.type.toLowerCase();
  const message = alert.message.toLowerCase();

  if (
    message.includes("sev1") ||
    message.includes("critical") ||
    type.includes("timeout")
  ) {
    return "sev1";
  }

  if (type.includes("failure") || type.includes("failed")) {
    return "sev2";
  }

  if (type.includes("ssl") || message.includes("expir")) {
    return "sev3";
  }

  return "sev4";
}

function deriveSource(alert: AlertHistory) {
  if (alert.targetType === "monitor") return "Monitor";
  if (alert.type.toLowerCase().includes("job")) return "Job";
  return titleCase(alert.targetType);
}

function deriveServiceHint(alert: AlertHistory) {
  const target = alert.targetName.trim();
  if (!target) return "Unmapped";

  return (
    target
      .replace(/\s+(monitor|job|check|test)$/i, "")
      .replace(/\s+-\s+(monitor|job|check|test)$/i, "")
      .trim() || target
  );
}

function deriveFingerprint(alert: AlertHistory) {
  return [alert.targetType, alert.targetId || alert.targetName, alert.type]
    .join(":")
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function deriveSreAlerts(alerts: AlertHistory[]) {
  const actionableAlerts = alerts.filter(isActionableSreSignal);
  const fingerprintCounts = new Map<string, number>();
  for (const alert of actionableAlerts) {
    const fingerprint = deriveFingerprint(alert);
    fingerprintCounts.set(
      fingerprint,
      (fingerprintCounts.get(fingerprint) ?? 0) + 1,
    );
  }

  return actionableAlerts.map((alert): DerivedSreAlert => {
    const fingerprint = deriveFingerprint(alert);
    return {
      id: alert.id,
      fingerprint,
      targetName: alert.targetName,
      source: deriveSource(alert),
      serviceHint: deriveServiceHint(alert),
      type: titleCase(alert.type),
      message: alert.message,
      severity: deriveSeverity(alert),
      timestamp: alert.timestamp,
      duplicateCount: fingerprintCounts.get(fingerprint) ?? 1,
    };
  });
}

function alertMatches(alert: DerivedSreAlert, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;

  return [
    alert.targetName,
    alert.source,
    alert.serviceHint,
    alert.type,
    alert.message,
    alert.fingerprint,
  ].some((value) => value.toLowerCase().includes(query));
}

function getAlertSortValue(alert: DerivedSreAlert, key: AlertSortKey) {
  if (key === "timestamp") return new Date(alert.timestamp).getTime();
  return alert[key];
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
  sortKey: AlertSortKey;
  activeKey: AlertSortKey;
  direction: SortDirection;
  onSort: (key: AlertSortKey) => void;
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

export function SreAlertsView({ alerts, isLoading }: SreAlertsViewProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sortKey, setSortKey] = useState<AlertSortKey>("timestamp");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(12);
  const [incidentByAlertId, setIncidentByAlertId] = useState<
    Record<string, number>
  >({});
  const [pendingAlertId, setPendingAlertId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const derivedAlerts = useMemo(() => deriveSreAlerts(alerts), [alerts]);
  const sourceOptions = useMemo(
    () =>
      Array.from(new Set(derivedAlerts.map((alert) => alert.source))).sort(),
    [derivedAlerts],
  );
  const filteredAlerts = useMemo(() => {
    const filtered = derivedAlerts.filter((alert) => {
      const matchesSeverity =
        severityFilter === "all" || alert.severity === severityFilter;
      const matchesSource =
        sourceFilter === "all" || alert.source === sourceFilter;
      return (
        matchesSeverity && matchesSource && alertMatches(alert, deferredSearch)
      );
    });

    return [...filtered].sort((a, b) => {
      const left = getAlertSortValue(a, sortKey);
      const right = getAlertSortValue(b, sortKey);
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
    derivedAlerts,
    severityFilter,
    sortDirection,
    sortKey,
    sourceFilter,
  ]);

  const pageCount = Math.max(1, Math.ceil(filteredAlerts.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedAlerts = filteredAlerts.slice(
    safePageIndex * pageSize,
    safePageIndex * pageSize + pageSize,
  );

  const handleCreateIncident = (alertHistoryId: string) => {
    setPendingAlertId(alertHistoryId);
    startTransition(async () => {
      const result = await createSreIncidentFromAlert({ alertHistoryId });
      setPendingAlertId(null);

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setIncidentByAlertId((current) => ({
        ...current,
        [alertHistoryId]: result.incident.incidentNumber,
      }));
      toast.success(result.message);
      router.push(`/incidents/${result.incident.id}`);
      router.refresh();
    });
  };

  const handleSort = (key: AlertSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection(key === "timestamp" ? "desc" : "asc");
    }
  };

  if (isLoading && alerts.length === 0) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <SupercheckLoading size="md" message="Loading alert signals..." />
      </div>
    );
  }

  if (derivedAlerts.length === 0) {
    return (
      <DashboardEmptyState
        className="min-h-[360px]"
        title="No alert signals yet"
        description="Only sent failure alerts appear here. Notification delivery failures stay in alert history."
        icon={<Siren className="h-12 w-12" />}
      />
    );
  }

  return (
    <div className="w-full max-w-full space-y-4 overflow-x-hidden p-2">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CardTitle className="text-2xl font-semibold">
              Alert signals
            </CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    aria-label="Alert signal scope"
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Delivery failures and recovery/success events stay in History.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <CardDescription>
            Failure alerts that can be promoted to incidents.
          </CardDescription>
        </div>
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
            value={sourceFilter}
            onValueChange={(value) => {
              setSourceFilter(value);
              setPageIndex(0);
            }}
          >
            <SelectTrigger className="h-8 w-[150px]">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sourceOptions.map((source) => (
                <SelectItem key={source} value={source}>
                  {source}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="w-full max-w-full overflow-hidden rounded-t-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead
                label="Signal"
                sortKey="targetName"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={handleSort}
                className="w-[260px]"
              />
              <SortableHead
                label="Type"
                sortKey="type"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={handleSort}
                className="w-44"
              />
              <SortableHead
                label="Service"
                sortKey="serviceHint"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={handleSort}
                className="w-48"
              />
              <TableHead className="w-[360px]">Message</TableHead>
              <SortableHead
                label="Repeats"
                sortKey="duplicateCount"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={handleSort}
                className="w-32"
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
                label="Source"
                sortKey="source"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={handleSort}
                className="w-40"
              />
              <SortableHead
                label="Last seen"
                sortKey="timestamp"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={handleSort}
                className="w-44"
              />
              <TableHead className="w-44" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedAlerts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="h-24 text-center text-muted-foreground"
                >
                  No signals match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              pagedAlerts.map((alert) => (
                <TableRow key={alert.id}>
                  <TableCell className="max-w-[260px] py-2.5">
                    <span
                      className="block truncate font-medium"
                      title={alert.targetName}
                    >
                      {alert.targetName}
                    </span>
                  </TableCell>
                  <TableCell
                    className="max-w-[180px] truncate py-2.5"
                    title={alert.type}
                  >
                    {alert.type}
                  </TableCell>
                  <TableCell
                    className="max-w-[200px] truncate py-2.5"
                    title={alert.serviceHint}
                  >
                    {alert.serviceHint}
                  </TableCell>
                  <TableCell className="max-w-[360px] py-2.5">
                    <span
                      className="block truncate text-muted-foreground"
                      title={alert.message}
                    >
                      {alert.message}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5">
                    {alert.duplicateCount > 1 ? (
                      <TableBadge compact>{alert.duplicateCount}</TableBadge>
                    ) : (
                      <span className="text-muted-foreground">1</span>
                    )}
                  </TableCell>
                  <TableCell className="py-2.5">
                    <TableBadge
                      tone={severityTones[alert.severity]}
                      compact
                      className="uppercase"
                    >
                      {alert.severity}
                    </TableBadge>
                  </TableCell>
                  <TableCell className="py-2.5">{alert.source}</TableCell>
                  <TableCell className="py-2.5">
                    <div className="inline-flex items-center gap-1 text-sm">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span suppressHydrationWarning>
                        {formatTimestamp(alert.timestamp)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="py-2.5">
                    {incidentByAlertId[alert.id] ? (
                      <TableBadge tone="info" compact>
                        Incident #{incidentByAlertId[alert.id]}
                      </TableBadge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCreateIncident(alert.id)}
                        disabled={isPending && pendingAlertId === alert.id}
                        className="h-8"
                      >
                        <Plus className="h-4 w-4" />
                        {isPending && pendingAlertId === alert.id
                          ? "Creating..."
                          : "Create incident"}
                      </Button>
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
          Total {filteredAlerts.length} signals
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
    </div>
  );
}
