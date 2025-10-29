"use client";

import React, { useState } from "react";
import Image from "next/image";
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  XCircle,
  Wrench,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { format, subDays, startOfDay, isSameDay } from "date-fns";
import { SubscribeDialog } from "./subscribe-dialog";
import Link from "next/link";

type ComponentStatus =
  | "operational"
  | "degraded_performance"
  | "partial_outage"
  | "major_outage"
  | "under_maintenance";
type IncidentStatus =
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved"
  | "scheduled";
type IncidentImpact = "none" | "minor" | "major" | "critical";

type StatusPage = {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  pageDescription: string | null;
  headline: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  cssGreens: string | null;
  cssYellows: string | null;
  cssOranges: string | null;
  cssBlues: string | null;
  cssReds: string | null;
  faviconLogo: string | null;
  transactionalLogo: string | null;
};

type Component = {
  id: string;
  name: string;
  description: string | null;
  status: ComponentStatus;
  showcase: boolean | null;
  onlyShowIfDegraded: boolean | null;
};

type Incident = {
  id: string;
  name: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  createdAt: Date | null;
  resolvedAt: Date | null;
  latestUpdate: {
    body: string;
    createdAt: Date | null;
  } | null;
  affectedComponents?: Array<{
    id: string;
    name: string;
  }>;
};

type PublicStatusPageProps = {
  statusPage: StatusPage;
  components: Component[];
  incidents: Incident[];
  idOrSubdomain: string;
  isPublicView?: boolean;
};

export function PublicStatusPage({
  statusPage,
  components,
  incidents,
  idOrSubdomain,
  isPublicView = false,
}: PublicStatusPageProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const DAYS_PER_PAGE = 7;

  // Calculate overall system status from components
  const calculateSystemStatus = () => {
    if (components.length === 0) return "operational";

    const statuses = components.map((c) => c.status);

    if (statuses.includes("major_outage")) return "major_outage";
    if (statuses.includes("partial_outage")) return "partial_outage";
    if (statuses.includes("degraded_performance"))
      return "degraded_performance";
    if (statuses.includes("under_maintenance")) return "under_maintenance";

    return "operational";
  };

  const systemStatus = calculateSystemStatus();

  // Get custom colors with fallbacks
  const colors = {
    green: statusPage.cssGreens || "#2ecc71",
    yellow: statusPage.cssYellows || "#f1c40f",
    orange: statusPage.cssOranges || "#e67e22",
    blue: statusPage.cssBlues || "#3498db",
    red: statusPage.cssReds || "#e74c3c",
  };

  const getSystemStatusDisplay = () => {
    switch (systemStatus) {
      case "operational":
        return {
          icon: CheckCircle2,
          text: "All Systems Operational",
          subtext: "All services are running normally",
          bgColor: colors.green,
        };
      case "degraded_performance":
        return {
          icon: AlertTriangle,
          text: "Degraded Performance",
          subtext: "Some services are experiencing issues",
          bgColor: colors.yellow,
        };
      case "partial_outage":
        return {
          icon: AlertCircle,
          text: "Partial Outage",
          subtext: "Some services are unavailable",
          bgColor: colors.orange,
        };
      case "major_outage":
        return {
          icon: XCircle,
          text: "Major Outage",
          subtext: "Services are currently unavailable",
          bgColor: colors.red,
        };
      case "under_maintenance":
        return {
          icon: Wrench,
          text: "Scheduled Maintenance",
          subtext: "Services are under maintenance",
          bgColor: colors.blue,
        };
      default:
        return {
          icon: CheckCircle2,
          text: "All Systems Operational",
          subtext: "All services are running normally",
          bgColor: colors.green,
        };
    }
  };

  const getComponentStatusDisplay = (status: ComponentStatus) => {
    switch (status) {
      case "operational":
        return {
          icon: CheckCircle2,
          text: "Operational",
          color: colors.green,
        };
      case "degraded_performance":
        return {
          icon: AlertTriangle,
          text: "Degraded Performance",
          color: colors.yellow,
        };
      case "partial_outage":
        return {
          icon: AlertCircle,
          text: "Partial Outage",
          color: colors.orange,
        };
      case "major_outage":
        return {
          icon: XCircle,
          text: "Major Outage",
          color: colors.red,
        };
      case "under_maintenance":
        return {
          icon: Wrench,
          text: "Under Maintenance",
          color: colors.blue,
        };
    }
  };

  const statusDisplay = getSystemStatusDisplay();
  const StatusIcon = statusDisplay.icon;

  // Filter components to show
  const visibleComponents = components.filter((component) => {
    if (!component.showcase) return false;
    if (component.onlyShowIfDegraded && component.status === "operational")
      return false;
    return true;
  });

  // Generate 90 days of uptime data based on incidents for a specific component
  const generateUptimeData = (componentId?: string): UptimeDayData[] => {
    const days = [];
    const statusPageCreatedDate = statusPage.createdAt
      ? startOfDay(new Date(statusPage.createdAt))
      : startOfDay(new Date());

    // Filter incidents by component if componentId is provided
    const relevantIncidents = componentId
      ? incidents.filter((incident) =>
          incident.affectedComponents?.some((c) => c.id === componentId)
        )
      : incidents;

    // Group incidents by date
    const incidentsByDate = new Map<string, Incident[]>();
    relevantIncidents.forEach((incident) => {
      if (incident.createdAt) {
        const dateKey = format(
          startOfDay(new Date(incident.createdAt)),
          "yyyy-MM-dd"
        );
        if (!incidentsByDate.has(dateKey)) {
          incidentsByDate.set(dateKey, []);
        }
        incidentsByDate.get(dateKey)!.push(incident);
      }
    });

    // Determine highest impact for each day
    const getHighestImpact = (
      dayIncidents: Incident[]
    ): IncidentImpact | null => {
      if (dayIncidents.length === 0) return null;

      const impactOrder: IncidentImpact[] = [
        "critical",
        "major",
        "minor",
        "none",
      ];
      for (const impact of impactOrder) {
        if (dayIncidents.some((inc) => inc.impact === impact)) {
          return impact;
        }
      }
      return "none";
    };

    for (let i = 89; i >= 0; i--) {
      const date = startOfDay(subDays(new Date(), i));
      const dateKey = format(date, "yyyy-MM-dd");
      const dayIncidents = incidentsByDate.get(dateKey) || [];
      const hasIncidents = dayIncidents.length > 0;
      const highestImpact = getHighestImpact(dayIncidents);

      // Show gray bars for days before the status page was created (no data)
      const isBeforeCreation = date < statusPageCreatedDate;

      if (isBeforeCreation) {
        days.push({
          date,
          isUp: null, // null indicates no data
          status: "nodata" as const,
          hasIncidents: false,
          highestImpact: null,
          dayIncidents: [],
        });
      } else {
        // For days after creation, show green if no incidents, otherwise show incident color
        days.push({
          date,
          isUp: !hasIncidents,
          status: hasIncidents ? ("incident" as const) : ("up" as const),
          hasIncidents,
          highestImpact,
          dayIncidents,
        });
      }
    }
    return days;
  };

  // Define a type for the uptime day data
  type UptimeDayData = {
    date: Date;
    isUp: boolean | null;
    status: "up" | "incident" | "nodata";
    hasIncidents: boolean;
    highestImpact: IncidentImpact | null;
    dayIncidents: Incident[];
  };

  const UptimeBar = ({
    data,
  }: {
    data: ReturnType<typeof generateUptimeData>;
  }) => {
    const [hoveredDay, setHoveredDay] = useState<number | null>(null);

    const getBarColor = (day: UptimeDayData) => {
      if (day.status === "nodata") {
        return "bg-gray-400 dark:bg-gray-600 hover:bg-gray-500 dark:hover:bg-gray-500";
      }

      if (!day.hasIncidents) {
        return colors.green;
      }

      // Color based on incident impact
      switch (day.highestImpact) {
        case "critical":
          return colors.red;
        case "major":
          return colors.orange;
        case "minor":
          return colors.yellow;
        default:
          return "#6b7280"; // gray-500
      }
    };

    return (
      <div className="relative">
        <div className="flex gap-1 items-center">
          {data.map((day, index) => (
            <div
              key={index}
              className="h-10 flex-1 relative cursor-pointer transition-all duration-200 hover:opacity-80"
              style={{
                backgroundColor:
                  day.status === "nodata" ? "#9ca3af" : getBarColor(day),
              }}
              onMouseEnter={() => setHoveredDay(index)}
              onMouseLeave={() => setHoveredDay(null)}
            />
          ))}
        </div>

        {/* Tooltip positioned below the bar */}
        {hoveredDay !== null && (
          <div
            className="absolute top-full left-0 mt-3 px-4 py-3 bg-gray-900 dark:bg-gray-800 text-white rounded-md shadow-xl z-50"
            style={{
              left: `${(hoveredDay / data.length) * 100}%`,
              transform: "translateX(-50%)",
              minWidth: "200px",
              maxWidth: "700px",
              width: "auto",
              fontSize: "13px",
            }}
          >
            <div className="font-semibold mb-2">
              {format(data[hoveredDay].date, "d MMM yyyy")}
            </div>

            {data[hoveredDay].status === "nodata" ? (
              <div className="text-gray-300 dark:text-gray-400">
                No data available for this day.
              </div>
            ) : !data[hoveredDay].hasIncidents ? (
              <div className="text-green-400">No downtime recorded</div>
            ) : (
              <div className="space-y-2">
                {data[hoveredDay].dayIncidents.map((incident) => (
                  <div
                    key={incident.id}
                    className="border-l-2 border-gray-600 pl-2"
                  >
                    <div className="font-medium text-white">
                      {incident.name}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5" style={{ whiteSpace: "nowrap" }}>
                      Impact:{" "}
                      <span
                        className={
                          incident.impact === "critical"
                            ? "text-red-400"
                            : incident.impact === "major"
                            ? "text-orange-400"
                            : incident.impact === "minor"
                            ? "text-yellow-400"
                            : "text-gray-400"
                        }
                      >
                        {incident.impact}
                      </span>
                      {" · "}
                      Status: {incident.status}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tooltip arrow */}
            <div className="absolute -top-1.5 left-1/2 transform -translate-x-1/2 w-3 h-3 rotate-45 bg-gray-900 dark:bg-gray-800"></div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {statusPage.transactionalLogo && (
              <Image
                src={statusPage.transactionalLogo}
                alt={statusPage.headline || statusPage.name}
                width={200}
                height={64}
                className="h-16 mb-4 object-contain object-left"
                unoptimized
              />
            )}
            <h1 className="text-3xl font-semibold text-gray-900 dark:text-gray-100">
              {statusPage.headline || statusPage.name}
            </h1>
            {statusPage.pageDescription && (
              <p className="text-gray-600 dark:text-gray-400 mt-2">
                {statusPage.pageDescription}
              </p>
            )}
          </div>
          <SubscribeDialog
            statusPageId={statusPage.id}
            statusPageName={statusPage.headline || statusPage.name}
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Current Status Banner */}
        <div
          className="rounded-lg p-6"
          style={{ backgroundColor: statusDisplay.bgColor }}
        >
          <div className="flex items-center gap-3">
            <StatusIcon className="h-6 w-6 text-white" />
            <span className="text-2xl font-medium text-white">
              {statusDisplay.text}
            </span>
          </div>
        </div>

        {/* Components Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
            <span></span>
            <span>Uptime over the past 90 days</span>
          </div>

          {visibleComponents.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-lg p-8 text-center">
              <p className="text-gray-500 dark:text-gray-400">
                No components configured yet
              </p>
            </div>
          ) : (
            <div className="space-y-0 bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-lg divide-y dark:divide-gray-800">
              {visibleComponents.map((component) => {
                const componentStatus = getComponentStatusDisplay(
                  component.status
                );
                // Generate uptime data specific to this component
                const uptimeData = generateUptimeData(component.id);
                // Only count days after status page creation (exclude "nodata" days)
                const validDays = uptimeData.filter(
                  (d) => d.status !== "nodata"
                );
                const uptimePercentage =
                  validDays.length > 0
                    ? (
                        (validDays.filter((d) => d.isUp).length /
                          validDays.length) *
                        100
                      ).toFixed(1)
                    : "0.0";

                return (
                  <div key={component.id} className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900 dark:text-gray-100">
                          {component.name}
                        </h3>
                        {component.description && (
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {component.description}
                          </p>
                        )}
                      </div>
                      <span
                        className="text-sm font-medium"
                        style={{ color: componentStatus.color }}
                      >
                        {componentStatus.text}
                      </span>
                    </div>

                    {/* 90-day uptime bar */}
                    <div className="space-y-2">
                      <UptimeBar data={uptimeData} />
                      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span>90 days ago</span>
                        <span>{uptimePercentage}% uptime</span>
                        <span>Today</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Past Incidents Section */}
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            Past Incidents
          </h2>

          {(() => {
            // Group incidents by date
            const incidentsByDate = new Map<string, Incident[]>();
            incidents.forEach((incident) => {
              if (incident.createdAt) {
                const dateKey = format(
                  new Date(incident.createdAt),
                  "yyyy-MM-dd"
                );
                if (!incidentsByDate.has(dateKey)) {
                  incidentsByDate.set(dateKey, []);
                }
                incidentsByDate.get(dateKey)!.push(incident);
              }
            });

            // Generate all 90 days
            const allDays = [];
            for (let i = 0; i < 90; i++) {
              const date = subDays(new Date(), i);
              const dateKey = format(date, "yyyy-MM-dd");
              const dayIncidents = incidentsByDate.get(dateKey) || [];
              allDays.push({ date, incidents: dayIncidents });
            }

            // Calculate pagination
            const totalPages = Math.ceil(allDays.length / DAYS_PER_PAGE);
            const startIndex = (currentPage - 1) * DAYS_PER_PAGE;
            const endIndex = startIndex + DAYS_PER_PAGE;
            const paginatedDays = allDays.slice(startIndex, endIndex);

            return (
              <>
                <div className="space-y-8">
                  {paginatedDays.map(({ date, incidents: dayIncidents }) => (
                    <div
                      key={format(date, "yyyy-MM-dd")}
                      className="pb-4 border-b dark:border-gray-800"
                    >
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
                        {format(date, "MMM d, yyyy")}
                      </h3>

                      {dayIncidents.length === 0 ? (
                        <p className="text-gray-600 dark:text-gray-400">
                          No incidents reported
                          {isSameDay(date, new Date()) ? " today" : ""}.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {dayIncidents.map((incident) => {
                            // Status color mapping for badges
                            const getStatusColor = (status: IncidentStatus) => {
                              switch (status) {
                                case "resolved":
                                  return "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-100";
                                case "investigating":
                                case "identified":
                                case "monitoring":
                                  return "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100";
                                case "scheduled":
                                  return "bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-100";
                                default:
                                  return "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100";
                              }
                            };

                            // Impact badge color mapping
                            const getImpactBadgeColor = (
                              impact: IncidentImpact
                            ) => {
                              switch (impact) {
                                case "critical":
                                  return "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-100";
                                case "major":
                                  return "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-100";
                                case "minor":
                                  return "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-100";
                                default:
                                  return "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100";
                              }
                            };

                            const incidentLinkBase = isPublicView
                              ? `/status/${idOrSubdomain}/incidents`
                              : `/status-pages/${statusPage.id}/public/incidents`;

                            return (
                              <Link
                                key={incident.id}
                                href={`${incidentLinkBase}/${incident.id}`}
                                className="block px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-950 transition-all duration-200 hover:bg-gray-100 dark:hover:bg-gray-900"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <h4 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                                      {incident.name}
                                    </h4>
                                    {incident.latestUpdate && (
                                      <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mt-1">
                                        {incident.latestUpdate.body}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                                    <span
                                      className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${getImpactBadgeColor(
                                        incident.impact
                                      )}`}
                                    >
                                      {incident.impact.charAt(0).toUpperCase() +
                                        incident.impact.slice(1)}
                                    </span>
                                    <span
                                      className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${getStatusColor(
                                        incident.status
                                      )}`}
                                    >
                                      {incident.status
                                        .split("_")
                                        .map(
                                          (word) =>
                                            word.charAt(0).toUpperCase() +
                                            word.slice(1)
                                        )
                                        .join(" ")}
                                    </span>
                                  </div>
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Pagination with footer */}
                <div className="flex items-center justify-between pt-6">
                  {totalPages > 1 ? (
                    <>
                      <div className="flex-1"></div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            setCurrentPage((prev) => Math.max(1, prev - 1))
                          }
                          disabled={currentPage === 1}
                          className="p-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          aria-label="Previous page"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>

                        <span className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400">
                          {currentPage} / {totalPages}
                        </span>

                        <button
                          onClick={() =>
                            setCurrentPage((prev) =>
                              Math.min(totalPages, prev + 1)
                            )
                          }
                          disabled={currentPage === totalPages}
                          className="p-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          aria-label="Next page"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex-1 text-right text-sm text-gray-600 dark:text-gray-400">
                        <span>Powered by </span>
                        <a
                          href="https://supercheck.io"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Supercheck
                        </a>
                      </div>
                    </>
                  ) : (
                    <div className="w-full text-center text-sm text-gray-600 dark:text-gray-400">
                      <span>Powered by </span>
                      <a
                        href="https://supercheck.io"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Supercheck
                      </a>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
