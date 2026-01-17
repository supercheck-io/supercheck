"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { canEditMonitors } from "@/lib/rbac/client-permissions";
import { Role } from "@/lib/rbac/permissions-client";
import { LoadingBadge, Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
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
  X,
  Shield,
  Bell,
  BellOff,
  FolderOpen,
  Copy,
  ChartNoAxesCombined,
} from "lucide-react";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { ReportViewer } from "@/components/shared/report-viewer";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { monitorStatuses, monitorTypes } from "@/components/monitors/data";
import { Monitor } from "./schema";
import {
  formatDistanceToNow,
  format,
  parseISO,
} from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";

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
import { TruncatedTextWithTooltip } from "@/components/ui/truncated-text-with-tooltip";
import {
  getLocationMetadata,
  calculateAggregatedStatus,
  isMonitoringLocation,
  MONITORING_LOCATIONS,
} from "@/lib/location-service";
import type {
  MonitoringLocation,
  LocationConfig,
} from "@/lib/location-service";
import type { MonitorConfig } from "@/db/schema";
import { useAppConfig } from "@/hooks/use-app-config";
import {
  useMonitorStats,
  useMonitorResults,
  useMonitorPermissions,
} from "@/hooks/use-monitor-details";
import { useQueryClient } from "@tanstack/react-query";
import { MONITORS_QUERY_KEY } from "@/hooks/use-monitors";

export interface MonitorResultItem {
  id: string;
  monitorId: string;
  checkedAt: string | Date;
  status: DBMonitorResultStatusType;
  responseTimeMs?: number | null;
  details?: DBMonitorResultDetailsType | null;
  isUp: boolean;
  isStatusChange: boolean;
  testExecutionId?: string | null;
  testReportS3Url?: string | null;
  location?: MonitoringLocation | string | null;
}

export type MonitorWithResults = Monitor & {
  recentResults?: MonitorResultItem[];
};

interface MonitorDetailClientProps {
  monitor: MonitorWithResults;
  isNotificationView?: boolean;
}

const formatDateTime = (dateTimeInput?: string | Date): string => {
  if (!dateTimeInput) return "N/A";
  try {
    const date =
      typeof dateTimeInput === "string"
        ? parseISO(dateTimeInput)
        : dateTimeInput;
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return "Invalid date";
  }
};

// Simple status icon component to replace the bar chart
const SimpleStatusIcon = ({ isUp }: { isUp: boolean }) => {
  return isUp ? (
    <CheckCircle className="h-4 w-4 text-green-500" />
  ) : (
    <XCircle className="h-4 w-4 text-red-500" />
  );
};

// Status icon for header
const StatusHeaderIcon = ({ status }: { status: string }) => {
  switch (status) {
    case "up":
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case "down":
      return <XCircle className="h-5 w-5 text-red-500" />;
    case "paused":
      return <Pause className="h-5 w-5 text-gray-500" />;
    default:
      return <AlertCircle className="h-5 w-5 text-yellow-500" />;
  }
};

export function MonitorDetailClient({
  monitor: initialMonitor,
  isNotificationView = false,
}: MonitorDetailClientProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { recentMonitorResultsLimit } = useAppConfig();



  const [monitor, setMonitor] = useState<MonitorWithResults>(initialMonitor);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [selectedReportUrl, setSelectedReportUrl] = useState<string | null>(
    null
  );
  const [selectedLocation, setSelectedLocation] = useState<"all" | string>(
    "all"
  );
  const resultsPerPage = 10;

  // React Query hooks for data fetching with caching
  const { stats: monitorStats, isRestoring: statsRestoring } = useMonitorStats(monitor.id, selectedLocation);
  const {
    results: paginatedTableResults,
    pagination: paginationMeta,
    isFetching: isLoadingResults,
    isRestoring: resultsRestoring,
  } = useMonitorResults(monitor.id, {
    page: currentPage,
    limit: resultsPerPage,
    date: selectedDate,
    location: selectedLocation,
  });
  const {
    userRole,
    isLoading: permissionsLoading,
  } = useMonitorPermissions(monitor.id);



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

  // Compute available locations from chart + paginated data
  const availableLocations = useMemo(() => {
    const locationSet = new Set<string>();
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
  }, [monitor.recentResults, paginatedTableResults]);

  // Reset location filter if selected location is no longer available
  useEffect(() => {
    if (
      selectedLocation !== "all" &&
      availableLocations.length > 0 &&
      !availableLocations.includes(selectedLocation)
    ) {
      setSelectedLocation("all");
    }
  }, [availableLocations, selectedLocation]);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      // Use the server action to delete the monitor
      const result = await deleteMonitor(monitor.id);

      if (!result?.success) {
        throw new Error(result?.error || "Failed to delete monitor");
      }

      toast.success(`Monitor "${monitor.name}" deleted successfully.`);

      // Invalidate Monitors cache to ensure fresh data on monitors list
      queryClient.invalidateQueries({ queryKey: MONITORS_QUERY_KEY, refetchType: 'all' });

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
    let newStatus: DBMoniotorStatusType =
      monitor.status === "paused" ? "up" : "paused";

    if (
      monitor.status === "paused" &&
      monitor.recentResults &&
      monitor.recentResults.length > 0
    ) {
      newStatus = monitor.recentResults[0].isUp ? "up" : "down";
    }

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
      queryClient.invalidateQueries({ queryKey: MONITORS_QUERY_KEY, refetchType: 'all' });

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
            ? getLocationMetadata(locationCode as MonitoringLocation)
            : undefined;

        return {
          name: format(date, "HH:mm"), // Show only time (HH:MM) for cleaner x-axis
          time: r.responseTimeMs ?? 0, // Use 0 for failed checks (null/undefined response times)
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
  }, [monitor.recentResults, selectedLocation]);

  // Use stats from API for accurate 24h and 30d metrics
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
          ? `${period24h.uptimePercentage.toFixed(1)}%`
          : "N/A",
      uptime30d:
        period30d.uptimePercentage !== null
          ? `${period30d.uptimePercentage.toFixed(1)}%`
          : "N/A",
      avgResponse24h:
        period24h.avgResponseTimeMs !== null
          ? `${(period24h.avgResponseTimeMs / 1000).toFixed(2)} s`
          : "N/A",
      p95Response24h:
        period24h.p95ResponseTimeMs !== null
          ? `${(period24h.p95ResponseTimeMs / 1000).toFixed(2)} s`
          : "N/A",
      avgResponse30d:
        period30d.avgResponseTimeMs !== null
          ? `${(period30d.avgResponseTimeMs / 1000).toFixed(2)} s`
          : "N/A",
      p95Response30d:
        period30d.p95ResponseTimeMs !== null
          ? `${(period30d.p95ResponseTimeMs / 1000).toFixed(2)} s`
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

  // Calculate current status, respecting aggregation strategy for multi-location setups
  const getAggregatedStatus = () => {
    if (!monitor.recentResults || monitor.recentResults.length === 0) {
      return monitor.status;
    }

    // When viewing a specific location, use that location's latest status
    if (selectedLocation !== "all") {
      const locationResults = monitor.recentResults.filter(
        (r) => r.location === selectedLocation
      );
      if (locationResults.length > 0) {
        return locationResults[0].isUp ? "up" : "down";
      }
      return monitor.status;
    }

    // When viewing all locations, aggregate based on strategy
    const monitorConfig = (monitor.config ?? null) as MonitorConfig | null;
    const locationConfig = monitorConfig?.locationConfig ?? null;

    // For single-location or non-multi-location monitors, use the most recent result
    if (!locationConfig || !locationConfig.enabled) {
      // Simply use the most recent result's status
      return monitor.recentResults[0].isUp ? "up" : "down";
    }

    const effectiveLocationsFromConfig =
      locationConfig.enabled &&
        Array.isArray(locationConfig.locations) &&
        locationConfig.locations.length > 0
        ? locationConfig.locations
        : null;

    const locationsFromResults = Array.from(
      new Set(
        (monitor.recentResults ?? [])
          .map((result) => result.location)
          .filter(
            (location): location is MonitoringLocation =>
              typeof location === "string" && isMonitoringLocation(location)
          )
      )
    );

    const effectiveLocations =
      effectiveLocationsFromConfig ??
      (locationsFromResults.length > 0
        ? locationsFromResults
        : [MONITORING_LOCATIONS.EU_CENTRAL]);

    // Get latest result for each location
    const latestByLocation: Record<MonitoringLocation, boolean> = {} as Record<
      MonitoringLocation,
      boolean
    >;
    for (const location of effectiveLocations) {
      const locationResult = monitor.recentResults.find(
        (r) => r.location === location
      );
      latestByLocation[location] = locationResult?.isUp ?? false;
    }

    // Apply aggregation strategy based on effective locations and config
    const aggregationConfig: LocationConfig =
      locationConfig && locationConfig.enabled
        ? {
          ...locationConfig,
          locations:
            locationConfig.locations && locationConfig.locations.length > 0
              ? locationConfig.locations
              : effectiveLocations,
          threshold:
            typeof locationConfig.threshold === "number"
              ? locationConfig.threshold
              : 50,
          strategy: locationConfig.strategy ?? "majority",
        }
        : {
          enabled: false,
          locations: effectiveLocations,
          threshold: 50,
          strategy: "majority",
        };

    const aggregated = calculateAggregatedStatus(
      latestByLocation,
      aggregationConfig
    );
    return aggregated === "partial" ? "down" : aggregated;
  };

  const currentActualStatus = getAggregatedStatus();

  const statusInfo = monitorStatuses.find(
    (s) => s.value === currentActualStatus
  );
  const monitorTypeInfo = monitorTypes.find((t) => t.value === monitor.type);

  const currentResponseTime =
    latestResult &&
      latestResult.responseTimeMs !== undefined &&
      latestResult.responseTimeMs !== null
      ? `${(latestResult.responseTimeMs / 1000).toFixed(2)} s`
      : "N/A";

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
          ? getLocationMetadata(locationCode as MonitoringLocation)
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
  }, [monitor.recentResults, selectedLocation]);

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
  }, [monitor.type, monitor.recentResults, monitor.config]);

  // Use pagination metadata from API
  const totalPages = paginationMeta?.totalPages || 0;
  const currentResultsCount = paginatedTableResults.length;
  const totalResultsCount = paginationMeta?.total || 0;

  // Reset page when date filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedDate]);

  const clearDateFilter = () => {
    setSelectedDate(undefined);
    setIsCalendarOpen(false);
  };

  return (
    <>
      <div className="h-full">
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
        <div className="border rounded-lg p-2 mb-4 shadow-sm bg-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {!isNotificationView && (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => router.push("/monitors")}
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="sr-only">Back to monitors</span>
                </Button>
              )}
              <div>
                <h1 className="text-2xl font-semibold flex items-center gap-2 mt-1">
                  {monitorTypeInfo?.icon && (
                    <monitorTypeInfo.icon
                      className={`h-6 w-6 ${monitorTypeInfo.color}`}
                    />
                  )}
                  {monitor.name.length > 40
                    ? monitor.name.slice(0, 40) + "..."
                    : monitor.name}
                </h1>
                <div className="flex items-center gap-2">
                  <div
                    className="text-sm text-muted-foreground truncate max-w-md"
                    title={monitor.url}
                  >
                    {monitor.type === "synthetic_test" &&
                      monitor.config?.testId ? (
                      <>
                        <span className="font-medium">Test ID:</span>{" "}
                        {monitor.config.testId}
                      </>
                    ) : monitor.type === "port_check" &&
                      monitor.config?.port ? (
                      `${monitor.target || monitor.url}:${monitor.config.port}`
                    ) : monitor.type === "http_request" &&
                      monitor.config?.method ? (
                      `${monitor.config.method.toUpperCase()} ${monitor.url || monitor.target
                      }`
                    ) : (
                      monitor.url || monitor.target
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
                        className="p-1 hover:bg-muted rounded transition-colors"
                        title={`Copy ${monitor.type === "synthetic_test" ? "Test ID" : "URL"
                          }`}
                      >
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {monitor.status === "paused" && (
                <div className="flex items-center px-2 py-1 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
                  <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mr-1" />
                  <span className="text-xs text-yellow-700 dark:text-yellow-300">
                    Monitoring paused
                  </span>
                </div>
              )}

              {/* Alert Status Indicators */}
              <div className="flex items-center gap-1 ml-1 mr-1">
                {/* Main Alert Status */}
                <div className="relative group mr-1">
                  <div
                    className={`flex items-center justify-center h-10 w-10 rounded-full ${monitor.alertConfig?.enabled
                      ? "bg-green-100 dark:bg-green-900/30"
                      : "bg-gray-100 dark:bg-gray-700/30"
                      }`}
                  >
                    {monitor.alertConfig?.enabled ? (
                      <Bell className="h-5 w-5 text-green-600 dark:text-green-400" />
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
                        <XCircle className="h-4 w-4 text-red-600 dark:text-red-500" />
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 text-xs text-white bg-gray-900 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10">
                          Monitor failure alert
                        </div>
                      </div>
                    )}
                    {monitor.alertConfig.alertOnRecovery && (
                      <div className="relative group">
                        <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-500" />
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
                    className={`flex items-center px-2 py-2 rounded-md border ${sslCertificateInfo.daysRemaining <= 7
                      ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                      : sslCertificateInfo.daysRemaining <= 30
                        ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800"
                        : "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                      }`}
                    title="SSL enabled"
                  >
                    <Shield
                      className={`h-4 w-4 mr-1 ${sslCertificateInfo.daysRemaining <= 7
                        ? "text-red-600 dark:text-red-400"
                        : sslCertificateInfo.daysRemaining <= 30
                          ? "text-yellow-600 dark:text-yellow-400"
                          : "text-green-600 dark:text-green-400"
                        }`}
                    />
                    <span
                      className={`text-xs ${sslCertificateInfo.daysRemaining <= 7
                        ? "text-red-700 dark:text-red-300"
                        : sslCertificateInfo.daysRemaining <= 30
                          ? "text-yellow-700 dark:text-yellow-300"
                          : "text-green-700 dark:text-green-300"
                        }`}
                    >
                      SSL: {sslCertificateInfo.daysRemaining}d remaining
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
              {!isNotificationView &&
                !permissionsLoading &&
                userRole &&
                canEditMonitors(userRole) && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleToggleStatus}
                    >
                      {monitor.status === "paused" ? (
                        <Play className="mr-2 h-4 w-4" />
                      ) : (
                        <Pause className="mr-2 h-4 w-4" />
                      )}
                      {monitor.status === "paused" ? "Resume" : "Pause"}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        router.push(`/monitors/${monitor.id}/edit`)
                      }
                      className="flex items-center"
                    >
                      <Edit3 className="h-4 w-4 mr-1" />
                      <span className="hidden sm:inline">Edit</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDeleteDialog(true)}
                      className="flex items-center text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/50"
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      <span className="hidden sm:inline">Delete</span>
                    </Button>
                  </>
                )}

              {/* Show loading state while fetching permissions - only in non-notification view */}
              {!isNotificationView && permissionsLoading && <LoadingBadge />}

              {/* Show disabled action buttons when user doesn't have management permissions - only in non-notification view */}
              {!isNotificationView &&
                !permissionsLoading &&
                userRole &&
                !canEditMonitors(userRole) && (
                  <>
                    <Button variant="outline" size="sm" disabled>
                      {monitor.status === "paused" ? (
                        <Play className="mr-2 h-4 w-4" />
                      ) : (
                        <Pause className="mr-2 h-4 w-4" />
                      )}
                      {monitor.status === "paused" ? "Resume" : "Pause"}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      disabled
                      className="flex items-center"
                    >
                      <Edit3 className="h-4 w-4 mr-1" />
                      <span className="hidden sm:inline">Edit</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled
                      className="flex items-center text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/50"
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      <span className="hidden sm:inline">Delete</span>
                    </Button>
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

          {/* Metric Cards - Single row with horizontal scroll on smaller screens */}
          <div className="flex gap-2.5 mt-4 mx-3 overflow-x-auto pb-4">
            <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 min-w-[120px] flex-shrink-0">
              <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
                <div className="flex items-center space-x-2">
                  <StatusHeaderIcon status={currentActualStatus} />
                  <CardTitle className="text-[13px] font-semibold text-muted-foreground whitespace-nowrap">
                    Status
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pb-4 px-4">
                <div className="text-xl font-semibold">
                  {statusInfo?.label ??
                    (currentActualStatus
                      ? currentActualStatus.charAt(0).toUpperCase() +
                      currentActualStatus.slice(1)
                      : "Pending")}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 min-w-[120px] flex-shrink-0">
              <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
                <div className="flex items-center space-x-2">
                  <Clock className="h-5 w-5 text-purple-500" />
                  <CardTitle className="text-[13px] font-semibold text-muted-foreground whitespace-nowrap">
                    Interval
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pb-4 px-4">
                <div className="text-xl font-semibold">
                  {monitor.frequencyMinutes ? (
                    `${monitor.frequencyMinutes}m`
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 min-w-[120px] flex-shrink-0">
              <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
                <div className="flex items-center space-x-2">
                  <Activity className="h-5 w-5 text-blue-500" />
                  <CardTitle className="text-[13px] font-semibold text-muted-foreground whitespace-nowrap">
                    Resp Time
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pb-4 px-4">
                <div className="text-xl font-semibold">
                  {currentResponseTime === "N/A" ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    currentResponseTime
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 min-w-[130px] flex-shrink-0">
              <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
                <div className="flex items-center space-x-2">
                  <TrendingUp className="h-5 w-5 text-green-400" />
                  <CardTitle className="text-[13px] font-semibold text-muted-foreground whitespace-nowrap">
                    Uptime
                  </CardTitle>
                </div>
                <span className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-medium text-muted-foreground ml-2">
                  24h
                </span>
              </CardHeader>
              <CardContent className="pb-4 px-4">
                <div className="text-xl font-semibold">
                  {calculatedMetrics.uptime24h === "N/A" ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    calculatedMetrics.uptime24h
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 min-w-[130px] flex-shrink-0">
              <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
                <div className="flex items-center space-x-2">
                  <Zap className="h-5 w-5 text-sky-500" />
                  <CardTitle className="text-[13px] font-semibold text-muted-foreground whitespace-nowrap">
                    Avg Resp
                  </CardTitle>
                </div>
                <span className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-medium text-muted-foreground ml-2">
                  24h
                </span>
              </CardHeader>
              <CardContent className="pb-4 px-4">
                <div className="text-xl font-semibold">
                  {calculatedMetrics.avgResponse24h === "N/A" ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    calculatedMetrics.avgResponse24h
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 min-w-[130px] flex-shrink-0">
              <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
                <div className="flex items-center space-x-2">
                  <ChartNoAxesCombined className="h-5 w-5 text-orange-500" />
                  <CardTitle className="text-[13px] font-semibold text-muted-foreground whitespace-nowrap">
                    P95 Resp
                  </CardTitle>
                </div>
                <span className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-medium text-muted-foreground ml-2">
                  24h
                </span>
              </CardHeader>
              <CardContent className="pb-4 px-4">
                <div className="text-xl font-semibold">
                  {calculatedMetrics.p95Response24h === "N/A" ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    calculatedMetrics.p95Response24h
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 min-w-[130px] flex-shrink-0">
              <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
                <div className="flex items-center space-x-2">
                  <TrendingUp className="h-5 w-5 text-green-400" />
                  <CardTitle className="text-[13px] font-semibold text-muted-foreground whitespace-nowrap">
                    Uptime
                  </CardTitle>
                </div>
                <span className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-medium text-muted-foreground ml-2">
                  30d
                </span>
              </CardHeader>
              <CardContent className="pb-4 px-4">
                <div className="text-xl font-semibold">
                  {calculatedMetrics.uptime30d === "N/A" ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    calculatedMetrics.uptime30d
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 min-w-[130px] flex-shrink-0">
              <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
                <div className="flex items-center space-x-2">
                  <Zap className="h-5 w-5 text-sky-500" />
                  <CardTitle className="text-[13px] font-semibold text-muted-foreground whitespace-nowrap">
                    Avg Resp
                  </CardTitle>
                </div>
                <span className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-medium text-muted-foreground ml-2">
                  30d
                </span>
              </CardHeader>
              <CardContent className="pb-4 px-4">
                <div className="text-xl font-semibold">
                  {calculatedMetrics.avgResponse30d === "N/A" ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    calculatedMetrics.avgResponse30d
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 min-w-[130px] flex-shrink-0">
              <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
                <div className="flex items-center space-x-2">
                  <ChartNoAxesCombined className="h-5 w-5 text-orange-500" />
                  <CardTitle className="text-[13px] font-semibold text-muted-foreground whitespace-nowrap">
                    P95 Resp
                  </CardTitle>
                </div>
                <span className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-medium text-muted-foreground ml-2">
                  30d
                </span>
              </CardHeader>
              <CardContent className="pb-4 px-4">
                <div className="text-xl font-semibold">
                  {calculatedMetrics.p95Response30d === "N/A" ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    calculatedMetrics.p95Response30d
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* For all monitors, show charts and results in two columns */}
          <div className="flex flex-col gap-4">
            <div>
              <AvailabilityBarChart
                data={availabilityTimelineData}
                headerActions={
                  availableLocations.length > 1 ? (
                    <LocationFilterDropdown
                      selectedLocation={selectedLocation}
                      availableLocations={availableLocations}
                      onLocationChange={setSelectedLocation}
                      className="w-[200px]"
                    />
                  ) : undefined
                }
              />
            </div>

            {/* Response Time Chart */}
            <div>
              <ResponseTimeBarChart data={responseTimeData} />
            </div>
          </div>

          <Card className="shadow-sm flex flex-col">
            <CardHeader className="flex-shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold flex items-center">
                  Recent Check Results
                </CardTitle>
                <div className="flex items-center gap-2">
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
                          date > new Date() || date < new Date("2020-01-01")
                        }
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <CardDescription>
                {selectedDate
                  ? `Showing ${currentResultsCount} of ${totalResultsCount} checks for ${format(
                    selectedDate,
                    "MMMM dd, yyyy"
                  )}`
                  : `Showing ${currentResultsCount} of ${totalResultsCount}${recentMonitorResultsLimit &&
                    totalResultsCount >= recentMonitorResultsLimit
                    ? "+"
                    : ""
                  } recent checks.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 flex-1 flex flex-col">
              <div className="w-full overflow-hidden relative">
                {/* Loading overlay - shows on top of existing data for smooth transitions */}
                {isLoadingResults && paginatedTableResults.length > 0 && (
                  <div className="absolute inset-0 z-20 bg-card/80 backdrop-blur-[1px] flex items-center justify-center transition-opacity duration-200">
                    <div className="bg-card border border-border rounded-lg shadow-sm px-6 py-4 flex flex-col items-center space-y-3">
                      <Spinner size="lg" className="text-primary" />
                      <div className="text-sm font-medium text-foreground">
                        Loading check results
                      </div>
                    </div>
                  </div>
                )}
                <div className="w-full">
                  <table className="w-full divide-y divide-border">
                    <thead className="bg-background sticky top-0 z-10 border-b">
                      <tr>
                        <th
                          scope="col"
                          className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-20"
                        >
                          Result
                        </th>
                        <th
                          scope="col"
                          className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-44"
                        >
                          Checked At
                        </th>
                        <th
                          scope="col"
                          className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-40"
                        >
                          Location
                        </th>
                        <th
                          scope="col"
                          className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-60"
                        >
                          Response Time
                        </th>
                        <th
                          scope="col"
                          className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-32"
                        >
                          Error
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-card divide-y divide-border">
                      {isLoadingResults &&
                        paginatedTableResults.length === 0 ? (
                        // Initial loading state (no data yet)
                        <tr>
                          <td
                            colSpan={monitor.type === "synthetic_test" ? 6 : 5}
                            className="text-center relative"
                            style={{ height: "320px" }}
                          >
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="bg-card/98 border border-border rounded-lg shadow-sm px-6 py-4 flex flex-col items-center space-y-3">
                                <Spinner size="lg" className="text-primary" />
                                <div className="text-sm font-medium text-foreground">
                                  Loading check results
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  Please wait...
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : paginatedTableResults &&
                        paginatedTableResults.length > 0 ? (
                        paginatedTableResults.map((result) => {
                          const locationMetadata = result.location
                            ? getLocationMetadata(
                              result.location as MonitoringLocation
                            )
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

                          return (
                            <tr key={result.id} className="hover:bg-muted/25">
                              <td className="px-4 py-[11.5px] whitespace-nowrap text-sm">
                                <SimpleStatusIcon isUp={result.isUp} />
                              </td>
                              <td className="px-4 py-[11.5px] whitespace-nowrap text-sm text-muted-foreground">
                                {formatDateTime(result.checkedAt)}
                              </td>
                              <td className="px-4 py-[11.5px] whitespace-nowrap text-xs text-muted-foreground">
                                {locationMetadata ? (
                                  <span className="flex items-center gap-1">
                                    {locationMetadata.flag && (
                                      <span className="text-[16px]">
                                        {locationMetadata.flag}
                                      </span>
                                    )}
                                    <span className="font-medium">
                                      {locationMetadata.name}
                                    </span>
                                  </span>
                                ) : result.location ? (
                                  result.location
                                ) : (
                                  "N/A"
                                )}
                              </td>
                              <td className="px-4 py-[11.5px] whitespace-nowrap text-sm text-muted-foreground">
                                {result.responseTimeMs !== null &&
                                  result.responseTimeMs !== undefined
                                  ? `${(result.responseTimeMs / 1000).toFixed(2)} s`
                                  : "N/A"}
                              </td>
                              <td className="px-4 py-[11.5px] text-sm text-muted-foreground">
                                {monitor.type === "synthetic_test" ? (
                                  // Synthetic test: show report on failure, N/A on success
                                  syntheticReportAvailable ? (
                                    <div
                                      className="cursor-pointer inline-flex items-center justify-center"
                                      onClick={() => {
                                        // Use testExecutionId directly from database
                                        const runTestId =
                                          result.testExecutionId;

                                        if (runTestId) {
                                          // Use API proxy route like playground does
                                          const apiUrl = `/api/test-results/${runTestId}/report/index.html?t=${Date.now()}&forceIframe=true`;
                                          setSelectedReportUrl(apiUrl);
                                          setReportModalOpen(true);
                                        } else {
                                          console.error(
                                            "[Monitor Report] No testExecutionId in monitor result:",
                                            result.id
                                          );
                                          toast.error("No report available", {
                                            description:
                                              "This monitor run doesn't have a report",
                                          });
                                        }
                                      }}
                                    >
                                      <PlaywrightLogo className="h-4 w-4 hover:opacity-80 transition-opacity" />
                                    </div>
                                  ) : syntheticReportError ? (
                                    <TruncatedTextWithTooltip
                                      text={syntheticReportError}
                                      className="text-muted-foreground text-xs"
                                      maxWidth="150px"
                                      maxLength={30}
                                    />
                                  ) : (
                                    <span className="text-muted-foreground text-xs">
                                      N/A
                                    </span>
                                  )
                                ) : // Other monitor types: show error on failure, N/A on success
                                  result.isUp ? (
                                    <span className="text-muted-foreground text-xs">
                                      N/A
                                    </span>
                                  ) : (
                                    <TruncatedTextWithTooltip
                                      text={
                                        result.details?.errorMessage ||
                                        "Check failed"
                                      }
                                      className="text-muted-foreground text-xs"
                                      maxWidth="150px"
                                      maxLength={30}
                                    />
                                  )}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        // Empty state
                        <tr>
                          <td
                            colSpan={monitor.type === "synthetic_test" ? 6 : 5}
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
                                  No check results available
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">
                                  Check results will appear here once monitoring
                                  begins.
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
              {paginatedTableResults &&
                paginatedTableResults.length > 0 &&
                paginationMeta &&
                totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t flex-shrink-0 bg-card rounded-b-lg">
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
        </div>

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
                className="bg-red-600 hover:bg-red-700"
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
