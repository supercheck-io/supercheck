"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { NewIncidentAction } from "@/components/sre/incidents/new-incident-action";
import { MonitorMaintenanceBar, maintenanceEndLabel } from "@/components/maintenance/maintenance-windows-panel";
import { useMaintenanceWindows, type MaintenanceWindowItem } from "@/hooks/use-maintenance-windows";
import { Button, buttonVariants } from "@/components/ui/button";
import { deleteMonitor } from "@/actions/delete-monitor";
import {
  ChevronLeft,
  Activity,
  CheckCircle,
  Clock,
  CalendarIcon,
  Trash2,
  Edit3,
  Play,
  Pause,
  Zap,
  TrendingUp,
  XCircle,
  AlertCircle,
  Wrench,
  X,
  Shield,
  Bell,
  BellOff,
  FolderOpen,
  Copy,
  ChartNoAxesCombined,
  CalendarClock,
  Timer,
  BrainCircuit,
} from "lucide-react";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { ReportViewer } from "@/components/shared/report-viewer";
import { AIMonitorAnalyzeButton } from "@/components/monitors/ai-monitor-analyze-button";
import { McpToolsButton } from "@/components/monitors/mcp-tools-panel";
import { typeText } from "@/lib/type-tones";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { displayMonitorType, monitorStatuses, monitorTypes } from "@/components/monitors/data";
import { Monitor } from "./schema";
import {
  format,
  parseISO,
  startOfDay,
  subDays,
} from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ResponseTimeBarChart } from "@/components/monitors/response-time-line-chart";
import { AvailabilityBarChart } from "./AvailabilityBarChart";
import { LocationFilterDropdown } from "./location-filter-dropdown";
import {
  MonitorStatus as DBMoniotorStatusType,
  MonitorResultStatus as DBMonitorResultStatusType,
  MonitorResultDetails as DBMonitorResultDetailsType,
} from "@/db/schema";
import { NavUser } from "@/components/nav-user";
import Link from "next/link";
import { SupercheckLogo } from "@/components/logo/supercheck-logo";
import { Home } from "lucide-react";
import { maskUrlPassword } from "@/lib/mask-url-password";
import { TruncatedTextWithTooltip } from "@/components/ui/truncated-text-with-tooltip";
import { TableBadge } from "@/components/ui/table-badge";
import {
  isMonitoringLocation,
  buildLocationMetadataMap,
  getLocationDisplayMetadata,
} from "@/lib/location-service";
import type { MonitoringLocation } from "@/lib/location-service";
import { resolveMonitorDetailStatus } from "@/lib/monitor-detail-status";
import { formatResponseTime } from "@/lib/format-response-time";
import {
  useMonitorStats,
  useMonitorResults,
  useMonitorPermissions,
} from "@/hooks/use-monitor-details";
import { useHydrated } from "@/hooks/use-hydrated";
import { useQueryClient } from "@tanstack/react-query";
import { formatUptime, getResumeStatus, invalidateMonitorCaches, invalidateDeletedMonitorCaches } from "./monitor-actions";
import { useLocationMetadata } from "@/hooks/use-locations";
import { HeartbeatPingUrlPanel } from "./heartbeat-ping-url-panel";
import { HeartbeatPingHistory } from "./heartbeat-ping-history";
import { HeartbeatStateBadge } from "./heartbeat-state-badge";
import { useFitPanelRows } from "./use-fit-panel-rows";
import { formatHeartbeatMinutes, formatPingAgo, formatPingDue, formatRunDuration } from "./heartbeat-format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface MonitorResultItem {
  id: string;
  monitorId: string;
  checkedAt: string | Date;
  status: DBMonitorResultStatusType;
  responseTimeMs?: number | null;
  details?: DBMonitorResultDetailsType | null;
  isUp: boolean;
  isStatusChange: boolean;
  /** Checked inside a maintenance window: muted and left out of uptime. */
  inMaintenance?: boolean;
  testExecutionId?: string | null;
  testReportS3Url?: string | null;
  location?: MonitoringLocation | string | null;
}

export type MonitorWithResults = Monitor & {
  recentResults?: MonitorResultItem[];
  /** Days of raw check results the organization keeps; undefined when unknown. `onPlan` is false when billing is off. */
  resultRetention?: { days: number; onPlan: boolean };
};

interface MonitorDetailClientProps {
  monitor: MonitorWithResults;
  isNotificationView?: boolean;
}

/** string, Date or epoch ms to a Date; null when it is none of those or not a valid date. */
export const toValidDate = (input: unknown): Date | null => {
  const date = typeof input === "string" ? parseISO(input) : input instanceof Date ? input : typeof input === "number" ? new Date(input) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

/** Compact "5m ago"; "—" when the value is missing or invalid. */
const formatDateTime = (dateTimeInput?: unknown): string => {
  const date = toValidDate(dateTimeInput);
  return date ? formatPingAgo(date) : "—";
};

// Simple status icon component to replace the bar chart
const SimpleStatusIcon = ({ isUp }: { isUp: boolean }) => {
  return isUp ? (
    <CheckCircle className="h-4 w-4 text-success" />
  ) : (
    <XCircle className="h-4 w-4 text-failure" />
  );
};

// Status icon for header
const StatusHeaderIcon = ({ status }: { status: string }) => {
  switch (status) {
    case "up":
      return <CheckCircle className="h-4 w-4 text-success" />;
    case "down":
      return <XCircle className="h-4 w-4 text-failure" />;
    case "paused":
      return <Pause className="h-4 w-4 text-muted-foreground" />;
    default:
      return <AlertCircle className="h-4 w-4 text-warning" />;
  }
};

const naToNull = (value: string) => (value === "N/A" ? null : value);

const STAMP = "MMM d, yyyy HH:mm:ss";

function MetricGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3 shadow-sm">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      <div className="grid auto-cols-fr grid-flow-col gap-3">{children}</div>
    </div>
  );
}

/** Fills the height of its grid row without adding to it, so the rows that fit can be measured without feedback. */
function FitPanel({ fit, minHeight, className = "", children }: { fit: boolean; minHeight: string; className?: string; children: React.ReactNode }) {
  if (!fit) return <>{children}</>;
  return (
    <div className={`relative ${minHeight} ${className}`}>
      <div className="lg:absolute lg:inset-0">{children}</div>
    </div>
  );
}

function MetricStat({
  icon,
  label,
  value,
  testId,
  valueTestId,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  testId?: string;
  /** On the value alone, for assertions on its exact text. */
  valueTestId?: string;
  /** Full text on hover or focus; replaces the native title. */
  tooltip?: string;
}) {
  const text = value ?? <span className="text-muted-foreground">—</span>;
  return (
    <div className="min-w-0" data-testid={testId} title={tooltip ? undefined : value ?? undefined}>
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground" data-metric-label="">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-xl font-semibold" data-metric-value="" data-testid={valueTestId}>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{text}</span>
            </TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        ) : (
          text
        )}
      </div>
    </div>
  );
}

/** "In maintenance until …" under the name; same query as the Schedule maintenance bar, so the actions stay on one line. */
function MaintenanceStatus({ monitorId }: { monitorId: string }) {
  const { data: activeWindows } = useMaintenanceWindows({ monitorId, state: "active" });
  const hydrated = useHydrated();
  // Alerts stay muted until the last of the overlapping windows ends.
  const until = activeWindows?.reduce<MaintenanceWindowItem | undefined>(
    (latest, window) => (!latest || (window.occurrenceEndsAt ?? "") > (latest.occurrenceEndsAt ?? "") ? window : latest),
    undefined,
  );
  if (!hydrated || !until) return null;
  return (
    <TableBadge tone="purple" compact className="shrink-0 gap-1" role="status" data-testid="monitor-maintenance-status">
      <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
      In maintenance until{" "}
      {until.occurrenceEndsAt ? maintenanceEndLabel(new Date(until.occurrenceEndsAt), until.timezone) : "-"}
    </TableBadge>
  );
}

type AiResultDetails = NonNullable<DBMonitorResultDetailsType["ai"]>;

/** AI endpoint numbers of one check, or undefined for a result without them. */
const aiDetails = (result?: { details?: DBMonitorResultDetailsType | null } | null): AiResultDetails | undefined => {
  const ai = result?.details?.ai;
  return ai && typeof ai === "object" ? ai : undefined;
};

const formatTokens = (ai?: AiResultDetails) =>
  typeof ai?.totalTokens === "number" ? ai.totalTokens.toLocaleString("en-US") : "N/A";

/** AI endpoint details of the latest check in a popover, like the MCP Tools button, so the header keeps the standard three groups. */
function AiEndpointButton({ requestedModel, latest, pending }: { requestedModel?: string; latest?: AiResultDetails; pending: boolean }) {
  const rows: Array<[label: string, testId: string, value: string | null]> = [
    ["First token", "ai-stat-first-token", typeof latest?.firstTokenMs === "number" ? formatResponseTime(latest.firstTokenMs) : null],
    ["Tokens per call", "ai-stat-tokens", naToNull(formatTokens(latest))],
    ["Prompt / completion", "ai-stat-token-split",
      typeof latest?.promptTokens === "number" && typeof latest?.completionTokens === "number"
        ? `${latest.promptTokens.toLocaleString("en-US")} / ${latest.completionTokens.toLocaleString("en-US")}`
        : null],
    ["Requested model", "ai-stat-requested-model", requestedModel || null],
    ["Served model", "ai-stat-served-model", latest?.servedModel ?? null],
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5" data-testid="ai-endpoint-button">
          <BrainCircuit className={`h-4 w-4 ${typeText("monitor", "ai_endpoint")}`} aria-hidden />
          AI details
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))]" aria-label="AI endpoint details" data-testid="ai-endpoint-panel">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">AI endpoint</h4>
          <p className="text-xs text-muted-foreground">{pending ? "Shown after the first check." : "From the latest check."}</p>
        </div>
        <dl className="mt-3 divide-y text-sm">
          {rows.map(([label, testId, value]) => (
            <div key={testId} className="flex items-center justify-between gap-4 py-2" data-testid={testId}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 truncate font-medium tabular-nums" title={value ?? undefined}>
                {value ?? <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

export function MonitorDetailClient({
  monitor: initialMonitor,
  isNotificationView = false,
}: MonitorDetailClientProps) {
  const router = useRouter();
  const queryClient = useQueryClient();



  const [monitor, setMonitor] = useState<MonitorWithResults>(initialMonitor);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [selectedReportUrl, setSelectedReportUrl] = useState<string | null>(
    null
  );
  const [selectedLocation, setSelectedLocation] = useState<"all" | string>(
    "all"
  );
  // The results table pages to the rows that fit its panel on desktop (10 on mobile and in the notification view).
  const [fitRows, setFitRows] = useState(10);
  const resultsPerPage = fitRows;
  const fitResults = !isNotificationView;
  const resultsPanelRef = useFitPanelRows(fitResults ? setFitRows : undefined, '[data-testid="monitor-result-row"]');

  // React Query hooks for data fetching with caching
  const { stats: monitorStats } = useMonitorStats(monitor.id, selectedLocation);
  const {
    results: paginatedTableResults,
    pagination: paginationMeta,
    isFetching: isLoadingResults,
    isPlaceholderData: isPlaceholderResults,
    error: resultsError,
    refetch: refetchResults,
  } = useMonitorResults(monitor.id, {
    page: currentPage,
    limit: resultsPerPage,
    date: selectedDate,
    location: selectedLocation,
    failuresOnly,
  });
  const {
    canEdit: canEditMonitor,
    canDelete: canDeleteMonitor,
    isLoading: permissionsLoading,
  } = useMonitorPermissions(monitor.id);
  const permissionsReady = hasHydrated && !permissionsLoading;
  // Pause/resume hits the update endpoint, so it needs the same permission as editing (as in the list row)
  const canToggleMonitor = canEditMonitor;

  // Dynamic location metadata
  const { locations: dynamicLocations } = useLocationMetadata();
  const dynamicMetadataMap = React.useMemo(() => {
    if (dynamicLocations.length > 0) {
      return buildLocationMetadataMap(dynamicLocations);
    }
    return {};
  }, [dynamicLocations]);

  const getMetadataForLocation = React.useCallback(
    (code: string) => {
      return getLocationDisplayMetadata(code, dynamicMetadataMap);
    },
    [dynamicMetadataMap]
  );



  // Copy to clipboard handler
  const handleCopy = useCallback((text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        toast.success(`${label} copied to clipboard`);
      })
      .catch(() => {
        toast.error(`Failed to copy ${label}`);
      });
  }, []);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  // Sync monitor state when props change
  useEffect(() => {
    if (
      initialMonitor &&
      initialMonitor.recentResults &&
      !Array.isArray(initialMonitor.recentResults)
    ) {
      setMonitor({ ...initialMonitor, recentResults: [] });
    } else {
      setMonitor(initialMonitor);
    }
  }, [initialMonitor]);

  // Configured locations first, so a location with no result in the latest 100 checks can still be picked,
  // plus any location seen in the chart or paginated data (a removed location may still have history).
  const configuredLocationList = (monitor.config?.locationConfig as { locations?: unknown } | undefined)?.locations;
  const configuredLocations = Array.isArray(configuredLocationList) ? configuredLocationList : undefined;
  const availableLocations = useMemo(() => {
    const locationSet = new Set<string>();
    configuredLocations?.forEach((location) => {
      if (isMonitoringLocation(location)) locationSet.add(location as MonitoringLocation);
    });
    if (monitor.recentResults && monitor.recentResults.length > 0) {
      monitor.recentResults.forEach((result) => {
        if (result.location && isMonitoringLocation(result.location)) {
          locationSet.add(result.location as MonitoringLocation);
        }
      });
    }
    if (paginatedTableResults && paginatedTableResults.length > 0) {
      paginatedTableResults.forEach((result) => {
        if (result.location && isMonitoringLocation(result.location)) {
          locationSet.add(result.location as MonitoringLocation);
        }
      });
    }
    return Array.from(locationSet).sort((a, b) => a.localeCompare(b));
  }, [configuredLocations, monitor.recentResults, paginatedTableResults]);

  // Reset location filter if selected location is no longer available. A filtered page (failures only or one
  // day) can lack the selected location's rows without the location being gone, so only an unfiltered page counts.
  useEffect(() => {
    if (
      !failuresOnly &&
      !selectedDate &&
      selectedLocation !== "all" &&
      availableLocations.length > 0 &&
      !availableLocations.includes(selectedLocation)
    ) {
      setSelectedLocation("all");
    }
  }, [availableLocations, selectedLocation, failuresOnly, selectedDate]);

  const handleDelete = async () => {
    if (!canDeleteMonitor) {
      toast.error("Insufficient permissions to delete monitors");
      setShowDeleteDialog(false);
      return;
    }

    setIsDeleting(true);
    try {
      // Use the server action to delete the monitor
      const result = await deleteMonitor(monitor.id);

      if (!result?.success) {
        throw new Error(result?.error || "Failed to delete monitor");
      }

      toast.success(`Monitor "${monitor.name}" deleted successfully.`);

      // Refresh the list; the deleted monitor's own queries would only 404 if refetched
      invalidateDeletedMonitorCaches(queryClient, monitor.id);

      router.push("/monitors");
      router.refresh();
    } catch (error) {
      console.error("Error deleting monitor:", error);
      toast.error((error as Error).message || "Could not delete monitor.");
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!canToggleMonitor) {
      toast.error("Insufficient permissions to control monitors");
      return;
    }

    const newStatus: DBMoniotorStatusType =
      monitor.status === "paused"
        ? getResumeStatus(monitor.recentResults?.[0]?.isUp)
        : "paused";

    try {
      const response = await fetch(`/api/monitors/${monitor.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to update monitor status.`);
      }

      const updatedMonitor = await response.json();

      // Update local state immediately for a responsive UI
      setMonitor((prev) => ({ ...prev, ...updatedMonitor, status: newStatus }));
      toast.success(
        `Monitor successfully ${newStatus === "paused" ? "paused" : "resumed"}.`
      );

      // Invalidate Monitors cache to ensure fresh data on monitors list
      invalidateMonitorCaches(queryClient, monitor.id);

      // Refresh server-side props to get the latest data
      router.refresh();
    } catch (error) {
      console.error("Error toggling monitor status:", error);
      toast.error(
        (error as Error).message || "Could not update monitor status."
      );
    }
  };

  // Removed unused handleToggleAlerts function

  // Note: Filtering is now handled server-side in the paginated API

  const responseTimeData = useMemo(() => {
    if (!monitor.recentResults || monitor.recentResults.length === 0) {
      return [];
    }

    // Filter by location if selected
    const filteredResults =
      selectedLocation === "all"
        ? monitor.recentResults
        : monitor.recentResults.filter((r) => r.location === selectedLocation);

    const chartData = filteredResults
      .map((r) => {
        const date =
          typeof r.checkedAt === "string" ? parseISO(r.checkedAt) : r.checkedAt;
        const locationCode = r.location;
        const metadata =
          locationCode && isMonitoringLocation(locationCode)
            ? getMetadataForLocation(locationCode)
            : undefined;

        return {
          name: format(date, "HH:mm"), // Show only time (HH:MM) for cleaner x-axis
          time: r.responseTimeMs ?? null, // null leaves a gap for failed checks instead of plotting 0 ms
          firstToken: typeof aiDetails(r)?.firstTokenMs === "number" ? Math.round(aiDetails(r)!.firstTokenMs as number) : null,
          fullDate: format(date, "MMM dd, HH:mm"), // Keep full date for tooltips
          isUp: r.isUp, // Keep status for conditional styling
          status: r.status,
          locationCode: r.location ?? null,
          locationName: metadata?.name ?? null,
          locationFlag: metadata?.flag ?? null,
        };
      })
      .reverse(); // Show chronologically (oldest first)

    return chartData;
  }, [monitor.recentResults, selectedLocation, getMetadataForLocation]);
  const calculatedMetrics = useMemo(() => {
    if (!monitorStats) {
      return {
        uptime24h: "N/A",
        uptime30d: "N/A",
        avgResponse24h: "N/A",
        p95Response24h: "N/A",
        avgResponse30d: "N/A",
        p95Response30d: "N/A",
      };
    }

    const { period24h, period30d } = monitorStats;

    return {
      uptime24h:
        period24h.uptimePercentage !== null
          ? formatUptime(period24h.uptimePercentage)
          : "N/A",
      uptime30d:
        period30d.uptimePercentage !== null
          ? formatUptime(period30d.uptimePercentage)
          : "N/A",
      avgResponse24h:
        period24h.avgResponseTimeMs !== null
          ? formatResponseTime(period24h.avgResponseTimeMs)
          : "N/A",
      p95Response24h:
        period24h.p95ResponseTimeMs !== null
          ? formatResponseTime(period24h.p95ResponseTimeMs)
          : "N/A",
      avgResponse30d:
        period30d.avgResponseTimeMs !== null
          ? formatResponseTime(period30d.avgResponseTimeMs)
          : "N/A",
      p95Response30d:
        period30d.p95ResponseTimeMs !== null
          ? formatResponseTime(period30d.p95ResponseTimeMs)
          : "N/A",
    };
  }, [monitorStats]);

  // Get latest result filtered by selected location
  const filteredLatestResults =
    monitor.recentResults && monitor.recentResults.length > 0
      ? selectedLocation === "all"
        ? monitor.recentResults
        : monitor.recentResults.filter((r) => r.location === selectedLocation)
      : [];

  const latestResult =
    filteredLatestResults.length > 0 ? filteredLatestResults[0] : null;

  const currentActualStatus = resolveMonitorDetailStatus(
    monitor.status,
    monitor.recentResults,
    selectedLocation
  );

  const statusInfo = monitorStatuses.find(
    (s) => s.value === currentActualStatus
  );
  const monitorTypeInfo = monitorTypes.find((t) => t.value === displayMonitorType(monitor));

  const currentResponseTime =
    latestResult &&
      latestResult.responseTimeMs !== undefined &&
      latestResult.responseTimeMs !== null
      ? formatResponseTime(latestResult.responseTimeMs)
      : "N/A";

  // Heartbeat: the job pings us, so the stats are about pings, not checks (spec 4.6)
  const heartbeat = monitor.type === "heartbeat" ? monitor.heartbeat : undefined;
  const isHeartbeat = monitor.type === "heartbeat";
  // The latest run only: a ping without /start has no duration, and an older run's must not stand in for it.
  const hasRunDurations = responseTimeData.some((d) => d.time !== null);
  const lastRunDuration = formatRunDuration(monitor.recentResults?.[0]?.responseTimeMs);
  // Never pinged: stays pending and never alerts, so there is no deadline to show
  const neverPinged = Boolean(heartbeat && !heartbeat.lastPingAt);
  const nextPingAt = heartbeat && !neverPinged && heartbeat.nextExpectedAt ? new Date(heartbeat.nextExpectedAt) : null;
  const showHeartbeatSetup = isHeartbeat && !isNotificationView;
  // Relative ping times ("8h ago", "in 52m") tick every 30 s while a heartbeat is open.
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [heartbeatChart, setHeartbeatChart] = useState<"availability" | "duration">("availability");
  useEffect(() => {
    if (!isHeartbeat) return;
    const id = window.setInterval(() => setClockNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [isHeartbeat]);
  
  // AI endpoint preset: extra stats from the latest check; a plain HTTP monitor shows none of this
  const aiEndpoint = monitor.config?.aiEndpoint as { model?: string } | undefined;
  const latestAi = aiEndpoint ? aiDetails(latestResult) : undefined;
  const aiHost = (() => {
    try {
      return new URL(monitor.target || monitor.url || "").hostname;
    } catch {
      return monitor.target || monitor.url || "";
    }
  })();

  // MCP Monitor: tool count, protocol and server identity come from the latest check; the tool list from the stored baseline
  const isMcp = monitor.type === "mcp_server";
  // Synthetic monitors on an agent test store details.agent; the column shows when any loaded result (not just this page) has it, so paging does not toggle it.
  const agentPassRate = (r: { details?: unknown }) => (r.details as { agent?: { passRate?: unknown } } | undefined)?.agent?.passRate;
  const showPassRate = monitor.type === "synthetic_test" && [...paginatedTableResults, ...(monitor.recentResults ?? [])].some((r) => typeof agentPassRate(r) === "number");
  const latestMcp = isMcp ? latestResult?.details?.mcp : undefined;
  const mcpServer = latestMcp?.serverName
    ? `${latestMcp.serverName}${latestMcp.serverVersion ? ` ${latestMcp.serverVersion}` : ""}`
    : null;
  // Server and protocol are small muted text in the Tools panel header, not a stat card.
  const mcpMeta = [mcpServer, latestMcp?.protocol ? `MCP ${latestMcp.protocol}` : null].filter(Boolean).join(" · ") || null;
  const mcpFailure = isMcp && latestResult && !latestResult.isUp ? latestResult.details?.errorMessage || "Check failed" : null;

  // Prepare data for AvailabilityBarChart (single location or filtered)
  const availabilityTimelineData = useMemo(() => {
    if (!monitor.recentResults || monitor.recentResults.length === 0) {
      return [];
    }

    const filteredResults =
      selectedLocation === "all"
        ? monitor.recentResults
        : monitor.recentResults.filter((r) => r.location === selectedLocation);

    return filteredResults
      .map((r) => {
        const timestamp =
          typeof r.checkedAt === "string" ? parseISO(r.checkedAt) : r.checkedAt;
        const locationCode = r.location ?? null;
        const locationMetadata = locationCode
          ? getMetadataForLocation(locationCode)
          : undefined;

        return {
          timestamp: timestamp.getTime(),
          status: (r.isUp ? 1 : 0) as 0 | 1,
          label: r.status,
          locationCode,
          locationName: locationMetadata?.name ?? null,
          locationFlag: locationMetadata?.flag ?? null,
        };
      })
      .reverse();
  }, [monitor.recentResults, selectedLocation, getMetadataForLocation]);

  // Extract SSL certificate info for website monitors
  const sslCertificateInfo = useMemo(() => {
    if (monitor.type !== "website") {
      return null;
    }

    // Check if SSL checking is currently enabled in monitor config
    const sslCheckEnabled = monitor.config?.enableSslCheck;

    if (!sslCheckEnabled) {
      return null;
    }

    // The worker saves the last certificate on the monitor; the SSL check runs about daily,
    // so recent results usually carry none. Results remain the fallback for older rows.
    const storedCert = monitor.config?.sslCertificate;
    let targetHost: string | undefined;
    try {
      targetHost = new URL(monitor.target || monitor.url || "").hostname.toLowerCase();
    } catch {
      targetHost = undefined;
    }
    // A certificate read before the target moved to another host is stale until the next check
    if (storedCert && storedCert.daysRemaining !== undefined && storedCert.host === targetHost) {
      // Count from validTo so the badge stays current between reads
      const validToMs = storedCert.validTo ? Date.parse(storedCert.validTo) : NaN;
      return {
        validTo: storedCert.validTo,
        daysRemaining: Number.isNaN(validToMs)
          ? storedCert.daysRemaining
          : Math.ceil((validToMs - Date.now()) / 86_400_000),
        valid: storedCert.valid,
        issuer: storedCert.issuer,
        subject: storedCert.subject,
      };
    }

    // Stored certificate is from another host: results are older still, so wait for the next read
    if (storedCert?.host && storedCert.host !== targetHost) {
      return null;
    }

    if (!monitor.recentResults || monitor.recentResults.length === 0) {
      return null;
    }

    // Find the most recent result with SSL certificate data
    const resultWithSsl = monitor.recentResults.find((r) => {
      return (
        r.details &&
        typeof r.details === "object" &&
        "sslCertificate" in r.details &&
        r.details.sslCertificate
      );
    });

    if (
      !resultWithSsl ||
      !resultWithSsl.details ||
      !("sslCertificate" in resultWithSsl.details)
    ) {
      return null;
    }

    const sslCert = resultWithSsl.details
      .sslCertificate as DBMonitorResultDetailsType["sslCertificate"];

    if (!sslCert) {
      return null;
    }

    return {
      validTo: sslCert.validTo,
      daysRemaining: sslCert.daysRemaining,
      valid: sslCert.valid,
      issuer: sslCert.issuer,
      subject: sslCert.subject,
    };
  }, [monitor.type, monitor.recentResults, monitor.config, monitor.target, monitor.url]);

  const heartbeatChartToggle = (
    <div role="group" aria-label="Heartbeat chart" className="flex items-center gap-1 rounded-md bg-muted p-0.5">
      {(["availability", "duration"] as const).map((chart) => (
        <Button
          key={chart}
          type="button"
          size="sm"
          variant={heartbeatChart === chart ? "outline" : "ghost"}
          className="h-7 px-2 text-xs"
          aria-pressed={heartbeatChart === chart}
          onClick={() => setHeartbeatChart(chart)}
        >
          {chart === "availability" ? "Availability" : "Run duration"}
        </Button>
      ))}
    </div>
  );

  const locationFilter =
    availableLocations.length > 1 ? (
      <LocationFilterDropdown
        selectedLocation={selectedLocation}
        availableLocations={availableLocations}
        onLocationChange={setSelectedLocation}
        className="w-[200px]"
      />
    ) : undefined;

  // Result, Checked At, Location, Response and Error, plus the type's own columns.
  const resultColumnCount = 5 + (aiEndpoint ? 2 : 0) + (isMcp ? 1 : 0) + (showPassRate ? 1 : 0);
  // Skeleton rows on the first load and while a new page or page size loads; a background refresh keeps the rows.
  const showResultsSkeleton = (isLoadingResults && paginatedTableResults.length === 0) || isPlaceholderResults;

  // Use pagination metadata from API
  const totalPages = paginationMeta?.totalPages || 0;
  const currentResultsCount = paginatedTableResults.length;
  const totalResultsCount = paginationMeta?.total || 0;

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedDate, selectedLocation, failuresOnly]);

  // A larger fitted page size can leave the current page past the end
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages, currentPage]);

  // Days the date filter can pick: today back to the oldest kept day (local time). With retention unknown, back to
  // the monitor's creation day.
  const retentionDays = monitor.resultRetention?.days;
  const createdAt = toValidDate(monitor.createdAt);
  const today = startOfDay(new Date());
  const firstSelectableDay = retentionDays
    ? subDays(today, retentionDays - 1)
    : createdAt
      ? startOfDay(createdAt)
      : undefined;
  const retentionHint = retentionDays
    ? `Check details are kept for ${retentionDays} days${monitor.resultRetention?.onPlan ? " on your plan" : ""}.`
    : undefined;
  const checksNoun = failuresOnly ? "failed checks" : "checks";
  // A failed request must not read as "every check passed".
  const emptyTitle = resultsError
    ? "Could not load check results"
    : failuresOnly
    ? "No failed checks"
    : selectedDate
      ? "No checks on this day"
      : "No check results available";
  const emptyDescription = resultsError
    ? "Refresh the page to try again."
    : failuresOnly
    ? selectedDate
      ? `Every check on ${format(selectedDate, "MMMM d")} passed.`
      : retentionDays
        ? `No check failed in the last ${retentionDays} days.`
        : "No recent check failed."
    : selectedDate
      ? "Pick another day or clear the date filter."
      : "Check results will appear here once monitoring begins.";

  const clearDateFilter = () => {
    setSelectedDate(undefined);
    setIsCalendarOpen(false);
  };

  return (
    <>
      <div className={fitResults ? "flex min-h-0 flex-1 flex-col" : "h-full"}>
        {/* Logo, breadcrumbs, and user nav for notification view */}
        {isNotificationView && (
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <SupercheckLogo className="h-8 w-8" />
              <div className="flex items-center gap-2 text-sm">
                <Link
                  href="/"
                  className="text-xl font-semibold text-foreground hover:opacity-80 transition-opacity"
                >
                  Supercheck
                </Link>

                <span className="mx-2 text-muted-foreground/30">|</span>
                <Link
                  href="/"
                  className="flex items-center gap-1 hover:text-foreground transition-colors text-muted-foreground"
                >
                  <Home className="h-4 w-4" />
                </Link>
                <span className="mx-1 text-muted-foreground">/</span>
                <span className="text-foreground">Monitor Report</span>
              </div>
            </div>
            <NavUser />
          </div>
        )}

        {/* Status and Type Header */}
        <div className="border rounded-lg p-4 mb-4 shadow-sm bg-card shrink-0" data-testid="monitor-detail-header">
          {/* One line on desktop: the name and target truncate (full text in the title) so the actions never wrap. */}
          <div className="flex flex-wrap items-center justify-between gap-2 lg:flex-nowrap">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {!isNotificationView && (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => router.push("/monitors")}
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="sr-only">Back to monitors</span>
                </Button>
              )}
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-semibold flex min-w-0 items-center gap-2 mt-1">
                  {monitorTypeInfo?.icon && (
                    <monitorTypeInfo.icon
                      className={`h-6 w-6 shrink-0 ${monitorTypeInfo.color}`}
                    />
                  )}
                  <span className="truncate" title={monitor.name} data-testid="monitor-detail-name">
                    {monitor.name}
                  </span>
                </h1>
                <div className={isHeartbeat ? "flex flex-wrap items-center gap-x-2 gap-y-1" : "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 lg:flex-nowrap"}>
                  {heartbeat && <HeartbeatStateBadge state={heartbeat.state} />}
                  {/* Needs the project context, which the notification view has none of. */}
                  {!isNotificationView && <MaintenanceStatus monitorId={monitor.id} />}
                  <div
                    className={isHeartbeat ? "flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground" : "min-w-0 truncate text-sm text-muted-foreground"}
                    title={isHeartbeat ? undefined : maskUrlPassword(monitor.url || monitor.target) ?? undefined}
                    data-testid="monitor-detail-target"
                  >
                    {isHeartbeat && heartbeat ? (
                      <>
                        <span data-testid="monitor-heartbeat-subtitle">
                          Every {formatHeartbeatMinutes(monitor.frequencyMinutes)} · grace {formatHeartbeatMinutes(heartbeat.graceMinutes)}
                        </span>
                      </>
                    ) : aiEndpoint ? (
                      <span data-testid="monitor-ai-subtitle">
                        {aiHost}
                        {aiEndpoint.model ? ` · ${aiEndpoint.model}` : ""}
                      </span>
                    ) : monitor.type === "synthetic_test" &&
                      monitor.config?.testId ? (
                      <>
                        <span className="font-medium">Test ID:</span>{" "}
                        {monitor.config.testId}
                      </>
                    ) : monitor.type === "port_check" &&
                      monitor.config?.port ? (
                      `${maskUrlPassword(monitor.target || monitor.url)}:${monitor.config.port}`
                    ) : monitor.type === "http_request" &&
                      monitor.config?.method ? (
                      `${monitor.config.method.toUpperCase()} ${maskUrlPassword(
                        monitor.url || monitor.target
                      )}`
                    ) : (
                      maskUrlPassword(monitor.url || monitor.target)
                    )}
                  </div>
                  {(monitor.url ||
                    monitor.target ||
                    (monitor.type === "synthetic_test" &&
                      monitor.config?.testId)) && (
                      <button
                        onClick={() =>
                          handleCopy(
                            monitor.type === "synthetic_test" &&
                              monitor.config?.testId
                              ? monitor.config.testId
                              : monitor.url || monitor.target || "",
                            monitor.type === "synthetic_test" ? "Test ID" : "URL"
                          )
                        }
                        className="shrink-0 rounded p-1 transition-colors hover:bg-muted"
                        title={`Copy ${monitor.type === "synthetic_test" ? "Test ID" : "URL"
                          }`}
                      >
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:flex-nowrap" data-testid="monitor-detail-actions">
              {/* Alert Status Indicators */}
              <div className="flex items-center gap-1 ml-1 mr-1">
                {/* Main Alert Status */}
                <div className="relative group mr-1">
                  <div
                    className={`flex items-center justify-center h-10 w-10 rounded-full ${monitor.alertConfig?.enabled
                      ? "bg-success/10"
                      : "bg-gray-100 dark:bg-gray-700/30"
                      }`}
                  >
                    {monitor.alertConfig?.enabled ? (
                      <Bell className="h-5 w-5 text-success" />
                    ) : (
                      <BellOff className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                    )}
                  </div>
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-900 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10">
                    {monitor.alertConfig?.enabled
                      ? "Alerts enabled"
                      : "Alerts disabled"}
                  </div>
                </div>

                {monitor.alertConfig?.enabled && (
                  <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                    {monitor.alertConfig.alertOnFailure && (
                      <div className="relative group">
                        <XCircle className="h-4 w-4 text-failure" />
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-900 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10">
                          Monitor failure alert
                        </div>
                      </div>
                    )}
                    {monitor.alertConfig.alertOnRecovery && (
                      <div className="relative group">
                        <CheckCircle className="h-4 w-4 text-success" />
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-900 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10">
                          Monitor recovery alert
                        </div>
                      </div>
                    )}
                    {monitor.alertConfig.alertOnSslExpiration &&
                      monitor.type === "website" &&
                      monitor.config?.enableSslCheck && (
                        <div className="relative group">
                          <Shield className="h-4 w-4 text-blue-600 dark:text-blue-500" />
                          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-900 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10">
                            SSL expiration alert
                          </div>
                        </div>
                      )}
                  </div>
                )}
              </div>

              {/* SSL Certificate Expiry for Website Monitors */}
              {monitor.type === "website" &&
                sslCertificateInfo &&
                sslCertificateInfo.daysRemaining !== undefined && (
                  <div
                    className={`flex items-center px-2 py-2 rounded-md border ${sslCertificateInfo.daysRemaining <= 7 || sslCertificateInfo.valid === false
                      ? "bg-failure/10 border-failure/30"
                      : sslCertificateInfo.daysRemaining <= 30
                        ? "bg-warning/10 border-warning/30"
                        : "bg-success/10 border-success/30"
                      }`}
                    title={sslCertificateInfo.validTo ? `Certificate valid until ${new Date(sslCertificateInfo.validTo).toLocaleDateString()}` : "SSL enabled"}
                  >
                    <Shield
                      className={`h-4 w-4 mr-1 ${sslCertificateInfo.daysRemaining <= 7 || sslCertificateInfo.valid === false
                        ? "text-failure"
                        : sslCertificateInfo.daysRemaining <= 30
                          ? "text-warning"
                          : "text-success"
                        }`}
                    />
                    <span
                      className={`text-xs ${sslCertificateInfo.daysRemaining <= 7 || sslCertificateInfo.valid === false
                        ? "text-failure"
                        : sslCertificateInfo.daysRemaining <= 30
                          ? "text-warning"
                          : "text-success"
                        }`}
                    >
                      SSL:{" "}
                      {sslCertificateInfo.daysRemaining <= 0
                        ? "expired"
                        : sslCertificateInfo.valid === false
                          ? "invalid certificate"
                          : `${sslCertificateInfo.daysRemaining}d remaining`}
                    </span>
                  </div>
                )}

              {/* Debug info for SSL when enabled but no certificate data */}
              {monitor.type === "website" &&
                monitor.config?.enableSslCheck &&
                !sslCertificateInfo && (
                  <div
                    className="flex items-center px-2 py-2 rounded-md border bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
                    title="SSL enabled but no certificate data available"
                  >
                    <Shield className="h-4 w-4 mr-1 text-blue-600 dark:text-blue-400" />
                    <span className="text-xs text-blue-700 dark:text-blue-300">
                      SSL: No certificate data yet
                    </span>
                  </div>
                )}

              {/* Action buttons - only show if user has manage permissions and not notification view */}
              {!isNotificationView && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={
                      permissionsReady && canToggleMonitor
                        ? handleToggleStatus
                        : undefined
                    }
                    disabled={!permissionsReady || !canToggleMonitor}
                    className={
                      !permissionsReady || !canToggleMonitor
                        ? "opacity-50 cursor-not-allowed"
                        : ""
                    }
                    aria-label={monitor.status === "paused" ? "Resume" : "Pause"}
                    title={
                      !permissionsReady
                        ? "Checking permissions"
                        : canToggleMonitor
                          ? "Pause or resume monitor"
                          : "Insufficient permissions to control monitors"
                    }
                  >
                    {monitor.status === "paused" ? (
                      <Play className="h-4 w-4 text-success 2xl:mr-2" />
                    ) : (
                      <Pause className="h-4 w-4 text-warning 2xl:mr-2" />
                    )}
                    {/* Pause, Edit, Delete and AI Analyze are icon-only below 2xl (1536px), so the header never wraps. */}
                    <span className="hidden 2xl:inline">{monitor.status === "paused" ? "Resume" : "Pause"}</span>
                  </Button>

                  <NewIncidentAction variant="detail" defaults={{ monitorId: monitor.id }} />
                  {/* Its "In maintenance" banner is shown under the name instead. */}
                  <div className="shrink-0 empty:hidden [&_[data-testid=maintenance-banner]]:hidden">
                    <MonitorMaintenanceBar monitorId={monitor.id} />
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={
                      permissionsReady && canEditMonitor
                        ? () => router.push(`/monitors/${monitor.id}/edit`)
                        : undefined
                    }
                    disabled={!permissionsReady || !canEditMonitor}
                    className="flex items-center"
                    aria-label="Edit"
                    title={
                      !permissionsReady
                        ? "Checking permissions"
                        : canEditMonitor
                          ? "Edit monitor"
                          : "Insufficient permissions to edit monitors"
                    }
                  >
                    <Edit3 className="h-4 w-4 2xl:mr-1" />
                    <span className="hidden 2xl:inline">Edit</span>
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={
                      permissionsReady && canDeleteMonitor
                        ? () => setShowDeleteDialog(true)
                        : undefined
                    }
                    disabled={!permissionsReady || !canDeleteMonitor}
                    className={`flex items-center ${
                      !permissionsReady || !canDeleteMonitor
                        ? "opacity-50 cursor-not-allowed text-muted-foreground"
                        : "text-failure border-failure/30 hover:text-failure hover:bg-failure/10"
                    }`}
                    aria-label="Delete"
                    title={
                      !permissionsReady
                        ? "Checking permissions"
                        : canDeleteMonitor
                          ? "Delete monitor"
                          : "Insufficient permissions to delete monitors"
                    }
                  >
                    <Trash2 className="h-4 w-4 2xl:mr-1" />
                    <span className="hidden 2xl:inline">Delete</span>
                  </Button>

                  <AIMonitorAnalyzeButton
                    monitorId={monitor.id}
                    monitorName={monitor.name}
                    monitorType={monitor.type}
                    disabled={!permissionsReady || !canEditMonitor}
                  />
                </>
              )}

              {/* In notification view, just show project name without action buttons */}
              {isNotificationView && monitor.projectName && (
                <div className="flex items-center px-2 py-2 rounded-md border bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
                  <FolderOpen className="h-4 w-4 mr-1 text-blue-600 dark:text-blue-400" />
                  <span className="text-xs text-blue-700 dark:text-blue-300">
                    {monitor.projectName}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Metric groups: current state, last 24 hours, last 30 days; a heartbeat shows its pings and uptime. */}
          {heartbeat ? (
          <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3" data-testid="heartbeat-overview">
            <MetricGroup title="Pings">
              <MetricStat
                icon={<Clock className="h-4 w-4 text-muted-foreground" />}
                label="Last ping"
                valueTestId="heartbeat-stat-last-ping"
                value={heartbeat.lastPingAt ? formatPingAgo(new Date(heartbeat.lastPingAt), clockNow) : "No pings yet"}
                tooltip={heartbeat.lastPingAt ? format(new Date(heartbeat.lastPingAt), STAMP) : undefined}
              />
              <MetricStat
                icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
                label="Next ping"
                valueTestId="heartbeat-stat-next"
                value={heartbeat.state === "paused" ? "Paused" : nextPingAt ? formatPingDue(nextPingAt, clockNow) : null}
                tooltip={heartbeat.state !== "paused" && nextPingAt ? format(nextPingAt, STAMP) : undefined}
              />
              <MetricStat
                icon={<Timer className="h-4 w-4 text-muted-foreground" />}
                label="Last run"
                valueTestId="heartbeat-stat-duration"
                value={lastRunDuration}
                tooltip={lastRunDuration ? undefined : "Call /start to record duration"}
              />
            </MetricGroup>
            <MetricGroup title="Uptime">
              <MetricStat
                icon={<TrendingUp className="h-4 w-4 text-success" />}
                label="Last 24 hours"
                value={naToNull(calculatedMetrics.uptime24h)}
              />
              <MetricStat
                icon={<TrendingUp className="h-4 w-4 text-success" />}
                label="Last 30 days"
                value={naToNull(calculatedMetrics.uptime30d)}
              />
            </MetricGroup>
          </div>
          ) : !isHeartbeat && (
          <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3 lg:[&>div>.grid]:gap-2">
            <MetricGroup title="Current">
              <MetricStat
                icon={<StatusHeaderIcon status={currentActualStatus} />}
                label="Status"
                value={
                  statusInfo?.label ??
                  (currentActualStatus
                    ? currentActualStatus.charAt(0).toUpperCase() +
                      currentActualStatus.slice(1)
                    : "Pending")
                }
              />
              <MetricStat
                icon={<Clock className="h-4 w-4 text-purple-500" />}
                label="Interval"
                value={
                  monitor.frequencyMinutes ? `${monitor.frequencyMinutes}m` : null
                }
              />
              <MetricStat
                icon={<Activity className="h-4 w-4 text-blue-500" />}
                label="Resp Time"
                value={currentResponseTime === "N/A" ? null : currentResponseTime}
              />
            </MetricGroup>

            <MetricGroup title="Last 24 hours">
              <MetricStat
                icon={<TrendingUp className="h-4 w-4 text-success" />}
                label="Uptime"
                value={naToNull(calculatedMetrics.uptime24h)}
              />
              <MetricStat
                icon={<Zap className="h-4 w-4 text-sky-500" />}
                label="Avg Resp"
                value={naToNull(calculatedMetrics.avgResponse24h)}
              />
              <MetricStat
                icon={<ChartNoAxesCombined className="h-4 w-4 text-orange-500" />}
                label="P95 Resp"
                value={naToNull(calculatedMetrics.p95Response24h)}
              />
            </MetricGroup>

            <MetricGroup title="Last 30 days">
              <MetricStat
                icon={<TrendingUp className="h-4 w-4 text-success" />}
                label="Uptime"
                value={naToNull(calculatedMetrics.uptime30d)}
              />
              <MetricStat
                icon={<Zap className="h-4 w-4 text-sky-500" />}
                label="Avg Resp"
                value={naToNull(calculatedMetrics.avgResponse30d)}
              />
              <MetricStat
                icon={<ChartNoAxesCombined className="h-4 w-4 text-orange-500" />}
                label="P95 Resp"
                value={naToNull(calculatedMetrics.p95Response30d)}
              />
            </MetricGroup>
          </div>
          )}
        </div>

        {isHeartbeat ? (
          // Desktop: setup and availability on the left, ping history on the right, both filling the window height.
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,min(58%,44rem))] lg:grid-rows-[minmax(22rem,1fr)]" data-testid="heartbeat-layout">
            {/* The row takes the window height like the other layouts (use-fit-panel-rows needs a height that does not depend on its rows); the setup and chart column scrolls inside it instead of growing it. */}
            <div className="flex min-h-0 min-w-0 flex-col gap-4 lg:overflow-y-auto lg:px-px">
              {showHeartbeatSetup && (
                <HeartbeatPingUrlPanel
                  monitorId={monitor.id}
                  canManage={permissionsReady && canEditMonitor}
                  pending={heartbeat?.state === "pending"}
                />
              )}
              {/* One chart slot: availability, or run duration once the job calls /start (a toggle switches). */}
              <div className={fitResults ? "flex min-h-[12rem] flex-1 flex-col" : "h-[400px]"}>
                {hasRunDurations && heartbeatChart === "duration" ? (
                  <ResponseTimeBarChart
                    data={responseTimeData}
                    title="Run duration"
                    headerActions={heartbeatChartToggle}
                    empty={{
                      description: "Time between a /start ping and the ping that finishes the run.",
                      heading: "No run durations yet",
                      hint: "Call /start when the job begins to record how long it runs.",
                    }}
                  />
                ) : (
                  <AvailabilityBarChart
                    data={availabilityTimelineData}
                    fill={fitResults}
                    headerActions={
                      hasRunDurations || locationFilter ? (
                        <div className="flex items-center gap-2">
                          {locationFilter}
                          {hasRunDurations && heartbeatChartToggle}
                        </div>
                      ) : undefined
                    }
                    footer={
                      hasRunDurations ? undefined : (
                        <span data-testid="heartbeat-run-duration-hint">
                          Call <span className="font-mono">/start</span> when the job begins to record how long it runs.
                        </span>
                      )
                    }
                  />
                )}
              </div>
            </div>
            <FitPanel fit={fitResults} minHeight="lg:min-h-[12rem]">
              <HeartbeatPingHistory
                results={paginatedTableResults}
                isLoading={isLoadingResults}
                error={resultsError}
                onRetry={() => void refetchResults()}
                page={currentPage}
                totalPages={totalPages}
                total={totalResultsCount}
                onPageChange={setCurrentPage}
                onFitRows={fitResults ? setFitRows : undefined}
              />
            </FitPanel>
          </div>
        ) : (
        // Desktop: the page fits the window; the charts share the left column and the wider results fill the right one.
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,min(58%,44rem))] lg:grid-rows-[minmax(22rem,1fr)]">
          {/* Both charts share the column height, so the results panel sets the page height. */}
          <div className="flex min-h-0 min-w-0 flex-col gap-4">
            <div className="shrink-0">
              <AvailabilityBarChart
                data={availabilityTimelineData}
                fill={fitResults}
                headerActions={
                  isMcp || aiEndpoint || locationFilter ? (
                    <div className="flex items-center gap-2">
                      {aiEndpoint && (
                        <AiEndpointButton requestedModel={aiEndpoint.model} latest={latestAi} pending={!latestResult} />
                      )}
                      {isMcp && (
                        <McpToolsButton
                          baseline={monitor.config?.mcpState?.baseline}
                          changes={monitor.config?.mcpState?.changes}
                          pending={!latestResult}
                          failure={mcpFailure}
                          meta={mcpMeta}
                        />
                      )}
                      {locationFilter}
                    </div>
                  ) : undefined
                }
              />
            </div>

            <div className={fitResults ? "min-h-[10.5rem] flex-1" : "h-[400px]"}>
              <ResponseTimeBarChart
                data={responseTimeData}
                showFirstToken={Boolean(aiEndpoint)}
              />
            </div>
          </div>

          <FitPanel fit={fitResults} minHeight="lg:min-h-[16rem]">
          <Card className="shadow-sm flex h-full flex-col overflow-hidden">
            <CardHeader className="flex-shrink-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-lg font-semibold flex items-center">
                  Recent Check Results
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 pr-1">
                    <Switch
                      id="monitor-results-failures-only"
                      checked={failuresOnly}
                      onCheckedChange={setFailuresOnly}
                      data-testid="failures-only-toggle"
                    />
                    <Label htmlFor="monitor-results-failures-only" className="text-sm font-normal">
                      Failures only
                    </Label>
                  </div>
                  {selectedDate && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearDateFilter}
                      className="h-8"
                    >
                      <X className="h-3 w-3 mr-1" />
                      Clear
                    </Button>
                  )}
                  <Popover
                    open={isCalendarOpen}
                    onOpenChange={setIsCalendarOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8">
                        <CalendarIcon className="h-3 w-3 mr-1" />
                        {selectedDate
                          ? format(selectedDate, "MMM dd")
                          : "Filter by date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <CalendarComponent
                        mode="single"
                        selected={selectedDate}
                        onSelect={(date: Date | undefined) => {
                          setSelectedDate(date);
                          setIsCalendarOpen(false);
                        }}
                        disabled={(date: Date) =>
                          date > new Date() || (firstSelectableDay !== undefined && date < firstSelectableDay)
                        }
                        startMonth={firstSelectableDay}
                        endMonth={today}
                        initialFocus
                      />
                      {retentionHint && (
                        <p className="max-w-[16rem] border-t px-3 py-2 text-xs text-muted-foreground" data-testid="results-retention-hint">
                          {retentionHint}
                        </p>
                      )}
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <CardDescription>
                {showResultsSkeleton
                  ? "Loading checks…"
                  : selectedDate
                  ? `Showing ${currentResultsCount} of ${totalResultsCount} ${checksNoun} for ${format(
                    selectedDate,
                    "MMMM dd, yyyy"
                  )}`
                  : `Showing ${currentResultsCount} of ${totalResultsCount} recent ${checksNoun}.`}
              </CardDescription>
            </CardHeader>
            <CardContent ref={resultsPanelRef} className="p-0 flex-1 flex min-h-0 flex-col">
              {/* Desktop never scrolls here: the page size is the rows that fit, and the columns fit the card width. */}
              <div className="w-full flex-1 overflow-x-auto lg:overflow-y-auto">
                <div className="w-full">
                  <table className={`w-full ${aiEndpoint ? "min-w-[600px]" : "min-w-[480px]"} table-fixed lg:min-w-0`}>
                    {/* Location and Error share the leftover width; long text ends in an ellipsis and shows in full on hover. */}
                    <colgroup>
                      <col className="w-[76px]" />
                      <col className="w-[84px]" />
                      <col className={aiEndpoint ? "w-[15%]" : "w-[20%]"} />
                      <col className="w-[80px]" />
                      {aiEndpoint && <col className="w-[84px]" />}
                      {aiEndpoint && <col className="w-[68px]" />}
                      {isMcp && <col className="w-[56px]" />}
                      {showPassRate && <col className="w-[80px]" />}
                      <col />
                    </colgroup>
                    <thead className="bg-background sticky top-0 z-10 border-b">
                      <tr>
                        <th
                          scope="col"
                          className="px-3 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                        >
                          Result
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                        >
                          Checked At
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                        >
                          Location
                        </th>
                        <th
                          scope="col"
                          className="px-3 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                        >
                          Response
                        </th>
                        {aiEndpoint && (
                          <th
                            scope="col"
                            className="px-3 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                          >
                            First token
                          </th>
                        )}
                        {aiEndpoint && (
                          <th
                            scope="col"
                            className="px-3 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                          >
                            Tokens
                          </th>
                        )}
                        {isMcp && (
                          <th
                            scope="col"
                            className="px-3 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                          >
                            Tools
                          </th>
                        )}
                        {showPassRate && (
                          <th
                            scope="col"
                            className="px-3 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                          >
                            Pass rate
                          </th>
                        )}
                        <th
                          scope="col"
                          className="px-3 py-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                        >
                          Error
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-card divide-y divide-border" data-testid="monitor-results-body" aria-busy={showResultsSkeleton || undefined}>
                      {showResultsSkeleton ? (
                        // Placeholder rows the size of the real ones, so the table keeps its shape while it loads.
                        Array.from({ length: resultsPerPage }, (_, index) => (
                          <tr key={`skeleton-${index}`} className="h-[45px]" data-testid="monitor-result-skeleton" aria-hidden="true">
                            {Array.from({ length: resultColumnCount }, (_, cell) => (
                              <td key={cell} className="px-3 py-[11.5px]">
                                <Skeleton className={cell === 0 ? "h-4 w-4 rounded-full" : "h-4 w-3/4"} />
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : paginatedTableResults &&
                        paginatedTableResults.length > 0 ? (
                        paginatedTableResults.map((result) => {
                          const locationMetadata = result.location
                            ? getMetadataForLocation(result.location)
                            : null;
                          // For synthetic tests: show report only if test failed, otherwise show N/A
                          const syntheticTestHasFailed =
                            monitor.type === "synthetic_test" && !result.isUp;
                          const syntheticReportAvailable =
                            syntheticTestHasFailed &&
                            Boolean(
                              result.details?.reportUrl ||
                              result.testReportS3Url
                            );

                          // Extract error message from synthetic test failure
                          const syntheticReportError =
                            monitor.type === "synthetic_test" &&
                              syntheticTestHasFailed
                              ? (() => {
                                const detail = result.details;
                                if (!detail) return undefined;
                                const primaryMessage =
                                  typeof detail.errorMessage === "string" &&
                                    detail.errorMessage.trim().length > 0
                                    ? detail.errorMessage.trim()
                                    : undefined;
                                if (primaryMessage) return primaryMessage;
                                const executionErrors =
                                  typeof detail.executionErrors ===
                                    "string" &&
                                    detail.executionErrors.trim().length > 0
                                    ? detail.executionErrors.trim()
                                    : undefined;
                                if (executionErrors) return executionErrors;
                                const executionSummary =
                                  typeof detail.executionSummary ===
                                    "string" &&
                                    detail.executionSummary.trim().length > 0
                                    ? detail.executionSummary.trim()
                                    : undefined;
                                return executionSummary;
                              })()
                              : undefined;

                          // Failure text for the Error column; a successful check has none.
                          const failureText = result.isUp
                            ? undefined
                            : monitor.type === "synthetic_test"
                              ? syntheticReportError
                              : result.details?.errorMessage || "Check failed";

                          return (
                            <tr key={result.id} className="h-[45px] hover:bg-muted/25" data-testid="monitor-result-row">
                              <td className="px-3 py-[11.5px] whitespace-nowrap text-sm">
                                <span className="inline-flex items-center gap-1.5">
                                  <SimpleStatusIcon isUp={result.isUp} />
                                  {result.inMaintenance && (
                                    // Icon-only: the column is narrow. The label is in aria-label and the tooltip.
                                    <TableBadge
                                      tone="purple"
                                      compact
                                      className="px-1.5"
                                      title="Checked during maintenance: no alert, not counted in uptime"
                                      role="img"
                                      aria-label="Checked during maintenance"
                                      data-testid="result-maintenance-badge"
                                    >
                                      <Wrench aria-hidden="true" className="h-3.5 w-3.5" />
                                    </TableBadge>
                                  )}
                                  {syntheticReportAvailable && (
                                    <button
                                      type="button"
                                      className="inline-flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                      aria-label="View test report"
                                      title="View test report"
                                      onClick={() => {
                                        // Use testExecutionId directly from database
                                        const runTestId = result.testExecutionId;
                                        if (runTestId) {
                                          // Use API proxy route like playground does
                                          setSelectedReportUrl(`/api/test-results/${runTestId}/report/index.html?forceIframe=true`);
                                          setReportModalOpen(true);
                                        } else {
                                          console.error("[Monitor Report] No testExecutionId in monitor result:", result.id);
                                          toast.error("No report available", {
                                            description: "This monitor run doesn't have a report",
                                          });
                                        }
                                      }}
                                    >
                                      <PlaywrightLogo className="h-4 w-4 hover:opacity-80 transition-opacity" />
                                    </button>
                                  )}
                                </span>
                              </td>
                              {/* Cells stay on one line; long values end in an ellipsis and show in full on hover. */}
                              <td className="px-3 py-[11.5px] overflow-hidden text-sm text-muted-foreground">
                                <span
                                  className="whitespace-nowrap"
                                  title={toValidDate(result.checkedAt) ? format(toValidDate(result.checkedAt)!, "MMM d, yyyy HH:mm:ss") : undefined}
                                >
                                  {formatDateTime(result.checkedAt)}
                                </span>
                              </td>
                              <td className="px-3 py-[11.5px] overflow-hidden text-xs text-muted-foreground">
                                {locationMetadata ? (
                                  <span className="flex min-w-0 items-center gap-1">
                                    {locationMetadata.flag && (
                                      <span className="shrink-0 text-[16px]">
                                        {locationMetadata.flag}
                                      </span>
                                    )}
                                    <TruncatedTextWithTooltip
                                      text={locationMetadata.name}
                                      className="min-w-0 font-medium"
                                      maxWidth="100%"
                                      maxLength={12}
                                    />
                                  </span>
                                ) : (
                                  <TruncatedTextWithTooltip
                                    text={result.location || "N/A"}
                                    maxWidth="100%"
                                    maxLength={14}
                                  />
                                )}
                              </td>
                              <td className="px-3 py-[11.5px] whitespace-nowrap overflow-hidden text-ellipsis text-sm text-muted-foreground">
                                {result.responseTimeMs !== null &&
                                  result.responseTimeMs !== undefined
                                  ? formatResponseTime(result.responseTimeMs)
                                  : "N/A"}
                              </td>
                              {aiEndpoint && (
                                <td className="px-3 py-[11.5px] whitespace-nowrap overflow-hidden text-ellipsis text-sm text-muted-foreground" data-testid="ai-row-first-token">
                                  {typeof aiDetails(result)?.firstTokenMs === "number"
                                    ? formatResponseTime(aiDetails(result)!.firstTokenMs as number)
                                    : "N/A"}
                                </td>
                              )}
                              {aiEndpoint && (
                                <td className="px-3 py-[11.5px] whitespace-nowrap overflow-hidden text-ellipsis text-sm text-muted-foreground" data-testid="ai-row-tokens">
                                  {formatTokens(aiDetails(result))}
                                </td>
                              )}
                              {isMcp && (
                                <td className="px-3 py-[11.5px] whitespace-nowrap overflow-hidden text-ellipsis text-sm text-muted-foreground" data-testid="mcp-row-tools">
                                  {typeof result.details?.mcp?.toolCount === "number" ? result.details.mcp.toolCount : "N/A"}
                                </td>
                              )}
                              {showPassRate && (
                                <td className="px-3 py-[11.5px] whitespace-nowrap overflow-hidden text-ellipsis text-sm text-muted-foreground" data-testid="agent-row-pass-rate">
                                  {typeof agentPassRate(result) === "number" ? `${Math.round((agentPassRate(result) as number) * 100)}%` : "N/A"}
                                </td>
                              )}
                              <td className="px-3 py-[11.5px] overflow-hidden text-xs text-muted-foreground" data-testid="result-error">
                                {failureText ? (
                                  <TruncatedTextWithTooltip text={failureText} maxWidth="100%" maxLength={24} />
                                ) : (
                                  "N/A"
                                )}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        // Empty state
                        <tr>
                          <td
                            colSpan={resultColumnCount}
                            className="px-4 py-16 text-center"
                          >
                            <div className="text-center space-y-3">
                              <div className="w-16 h-16 mx-auto rounded-full bg-muted/50 flex items-center justify-center">
                                <svg
                                  className="w-8 h-8 text-muted-foreground"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                                  />
                                </svg>
                              </div>
                              <div>
                                <p className="text-muted-foreground font-medium">
                                  {emptyTitle}
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">
                                  {emptyDescription}
                                </p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Always shown once there are results, so the reserved pager height is never an empty gap. */}
              {paginatedTableResults &&
                paginatedTableResults.length > 0 &&
                paginationMeta && (
                  <div className="flex items-center justify-between px-4 py-3 border-t flex-shrink-0 bg-card rounded-b-lg" data-fit-pager="">
                    <div className="text-sm text-muted-foreground">
                      Page {currentPage} of {totalPages}
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setCurrentPage((prev) => Math.max(1, prev - 1))
                        }
                        disabled={currentPage === 1 || isLoadingResults}
                        className="min-w-[80px]"
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setCurrentPage((prev) =>
                            Math.min(totalPages, prev + 1)
                          )
                        }
                        disabled={
                          currentPage === totalPages || isLoadingResults
                        }
                        className="min-w-[60px]"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
            </CardContent>
          </Card>
          </FitPanel>
        </div>
        )}

        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete the
                monitor &quot;{monitor.name}&quot; and all its associated data.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={isDeleting}
                className={buttonVariants({ variant: "destructive" })}
              >
                {isDeleting ? (
                  <div className="flex items-center gap-2">
                    <Spinner size="sm" />
                    Deleting...
                  </div>
                ) : (
                  "Delete"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Playwright Report Modal - Full Screen Overlay */}
        {reportModalOpen && selectedReportUrl && (
          <div className="fixed inset-0 z-50 bg-card/80 backdrop-blur-sm">
            <div className="fixed inset-8 bg-card rounded-lg shadow-lg flex flex-col overflow-hidden border">
              <div className="p-4 border-b flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PlaywrightLogo width={36} height={36} />
                  <h2 className="text-xl font-semibold">Monitor Report</h2>
                </div>
                <Button
                  className="cursor-pointer bg-secondary hover:bg-secondary/90"
                  size="sm"
                  onClick={() => {
                    setReportModalOpen(false);
                    setSelectedReportUrl(null);
                  }}
                >
                  <X className="h-4 w-4 text-secondary-foreground" />
                </Button>
              </div>
              <div className="flex-grow overflow-hidden">
                <ReportViewer
                  reportUrl={selectedReportUrl}
                  containerClassName="w-full h-full"
                  iframeClassName="w-full h-full"
                  loadingMessage="Loading monitor report..."
                  hideEmptyMessage={true}
                  hideFullscreenButton={true}
                  hideReloadButton={true}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
