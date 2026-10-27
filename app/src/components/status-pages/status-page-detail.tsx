"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ExternalLink,
  Upload,
  EyeOff,
  Loader2,
  Copy,
  Activity,
  Tally4,
  Layers,
  OctagonAlert,
  Users,
  LayoutDashboard,
  Settings2,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { ComponentsTab } from "./components-tab";
import { IncidentsTab } from "./incidents-tab";
import { SubscribersTab } from "./subscribers-tab";
import { SettingsTab } from "./settings-tab";
import { StatusPageInfoPopover } from "./status-page-info-popover";

import {
  publishStatusPage,
  unpublishStatusPage,
} from "@/actions/publish-status-page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { getPublicStatusPageUrl } from "@/lib/domain-utils";
import { DataTable } from "@/components/monitors/data-table";
import { statusPageColumns } from "@/components/monitors/status-page-columns";
import { toOverviewMonitor } from "./overview-monitor";
import type { StatusPageMonitor } from "@/hooks/use-status-pages";

type StatusPage = {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  pageDescription: string | null;
  headline: string | null;
  supportUrl: string | null;
  timezone: string | null;
  allowPageSubscribers: boolean | null;
  allowEmailSubscribers: boolean | null;
  allowWebhookSubscribers: boolean | null;
  allowIncidentSubscribers: boolean | null;
  allowSlackSubscribers: boolean | null;
  allowRssFeed: boolean | null;
  notificationsFromEmail: string | null;
  notificationsEmailFooter: string | null;
  customDomain: string | null;
  customDomainVerified: boolean | null;
  language: string | null;
  cssBodyBackgroundColor: string | null;
  cssFontColor: string | null;
  cssGreens: string | null;
  cssYellows: string | null;
  cssOranges: string | null;
  cssBlues: string | null;
  cssReds: string | null;
  faviconLogo: string | null;
  transactionalLogo: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

type Component = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  monitors: StatusPageMonitor[];
  monitorIds: string[];
  aggregationMethod: string;
  failureThreshold: number;
  showcase: boolean | null;
  onlyShowIfDegraded: boolean | null;
  position: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

type PendingAction = "unpublish" | "archive";

type StatusPageDetailProps = {
  statusPage: StatusPage;
  statusPageDomain?: string;
  statusPageCnameTarget?: string;
  monitors: StatusPageMonitor[];
  components: Component[];
  canUpdate: boolean;
  stats?: {
    activeIncidents: number;
    subscribers: number;
    failedMonitors: number;
  };
  onDataChange?: () => void;
};

export function StatusPageDetail({
  statusPage,
  statusPageDomain,
  statusPageCnameTarget,
  monitors,
  components,
  canUpdate,
  stats,
  onDataChange,
}: StatusPageDetailProps) {
  const router = useRouter();
  const [isPublishing, setIsPublishing] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [confirmAction, setConfirmAction] = useState<PendingAction | null>(null);
  const [appUrl, setAppUrl] = useState<string>();

  useEffect(() => {
    setAppUrl(window.location.origin);
  }, []);

  const shouldDeferPublicUrl = statusPageDomain === "localhost" && !appUrl;
  const publicStatusPageUrl = shouldDeferPublicUrl
    ? null
    : getPublicStatusPageUrl({
        subdomain: statusPage.subdomain,
        customDomain: statusPage.customDomain,
        customDomainVerified: statusPage.customDomainVerified,
        appUrl,
        statusPageDomain,
      });

  const handleCopyUrl = () => {
    if (!publicStatusPageUrl) {
      return;
    }

    navigator.clipboard.writeText(publicStatusPageUrl);
    toast.success("URL copied to clipboard", {
      description: publicStatusPageUrl,
    });
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      const result = await publishStatusPage(statusPage.id);
      if (result.success) {
        toast.success("Status page published successfully", {
          description: publicStatusPageUrl
            ? `Your status page is now publicly accessible at ${publicStatusPageUrl}`
            : "Your status page is now publicly accessible",
        });
        router.refresh();
      } else {
        toast.error("Failed to publish status page", {
          description: result.message,
        });
      }
    } catch (error) {
      console.error("Error publishing status page:", error);
      toast.error("Failed to publish status page", {
        description: "An unexpected error occurred",
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const handleDestructiveAction = async (action: PendingAction) => {
    const isArchive = action === "archive";
    setPendingAction(action);
    try {
      const result = await unpublishStatusPage(statusPage.id, isArchive);
      if (result.success) {
        toast.success(
          isArchive
            ? "Status page archived"
            : "Status page unpublished successfully",
          {
            description: isArchive
              ? "The page is no longer publicly accessible. Its records stay in the dashboard."
              : "Your status page is no longer publicly accessible and has been returned to draft.",
          },
        );
        router.refresh();
        return true;
      }

      toast.error(
        isArchive
          ? "Failed to archive status page"
          : "Failed to unpublish status page",
        { description: result.message },
      );
      return false;
    } catch (error) {
      console.error(
        `Error ${isArchive ? "archiving" : "unpublishing"} status page:`,
        error,
      );
      toast.error(
        isArchive
          ? "Failed to archive status page"
          : "Failed to unpublish status page",
        { description: "An unexpected error occurred" },
      );
      return false;
    } finally {
      setPendingAction(null);
    }
  };

  const runConfirmedAction = async () => {
    const action = confirmAction;
    if (!action || pendingAction || !canUpdate) {
      return;
    }

    const succeeded = await handleDestructiveAction(action);

    if (succeeded) {
      setConfirmAction(null);
    }
  };

  const confirmCopy =
    confirmAction === "archive"
      ? {
          title: `Archive "${statusPage.name}"?`,
          description:
            "Archiving takes this page off the public internet and marks it archived. Components, incidents, and subscribers are kept, and you can publish the page again later if you need it live.",
          actionLabel: "Archive page",
        }
      : {
          title: `Unpublish "${statusPage.name}"?`,
          description:
            "Unpublishing takes this page offline immediately. Visitors will see a not-found page until you publish it again. Components, incidents, and subscribers are kept.",
          actionLabel: "Unpublish page",
        };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "published":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "draft":
        return "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
      case "archived":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
      default:
        return "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
    }
  };

  return (
    <div className="space-y-6 p-4">
      <Tabs defaultValue="overview" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="min-w-0 max-w-full truncate text-xl sm:text-2xl font-semibold">{statusPage.name}</h1>
              <Badge
                className={`text-xs px-2 py-1 rounded-md ${getStatusBadgeColor(
                  statusPage.status
                )}`}
              >
                {statusPage.status}
              </Badge>
              <StatusPageInfoPopover />
            </div>
            {statusPage.headline && (
              <p className="text-base sm:text-lg text-muted-foreground mb-2 truncate">
                {statusPage.headline}
              </p>
            )}
            {statusPage.pageDescription && (
              <p className="text-sm text-muted-foreground line-clamp-2">
                {statusPage.pageDescription}
              </p>
            )}
            {publicStatusPageUrl ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-3 min-w-0">
                <Tally4 className="h-4 w-4 flex-shrink-0 !text-green-600" />
                <span className="min-w-0 truncate font-mono text-xs sm:text-sm">
                  {publicStatusPageUrl}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 flex-shrink-0"
                  onClick={handleCopyUrl}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-shrink-0 sm:justify-end sm:gap-3">
            <Button
              asChild
              variant="outline"
              size="default"
              className="border-2 hover:bg-muted"
            >
              <Link href={`/status-pages/${statusPage.id}/public`}>
                <ExternalLink className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Preview</span>
                <span className="sm:hidden">View</span>
              </Link>
            </Button>
            {statusPage.status !== "archived" && (
              <Button
                variant="destructive"
                disabled={isPublishing || pendingAction !== null || !canUpdate}
                onClick={() => setConfirmAction("archive")}
                title={
                  !canUpdate ? "You don't have permission to archive" : undefined
                }
              >
                {pendingAction === "archive" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Archive
              </Button>
            )}
            {statusPage.status === "published" ? (
              <Button
                variant="destructive"
                size="default"
                onClick={() => setConfirmAction("unpublish")}
                disabled={
                  isPublishing || pendingAction !== null || !canUpdate
                }
                title={
                  !canUpdate ? "You don't have permission to unpublish" : ""
                }
              >
                {pendingAction === "unpublish" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <EyeOff className="h-4 w-4 mr-2" />
                )}
                Unpublish
              </Button>
            ) : (
              <Button
                size="default"
                onClick={handlePublish}
                disabled={isPublishing || !canUpdate}
                className="bg-green-600 hover:bg-green-700 text-white shadow-md"
                title={!canUpdate ? "You don't have permission to publish" : ""}
              >
                {isPublishing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Publish
              </Button>
            )}
          </div>
        </div>

        <AlertDialog
          open={confirmAction !== null}
          onOpenChange={(open) => {
            if (!open && !pendingAction) {
              setConfirmAction(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmCopy.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmCopy.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pendingAction !== null}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/30"
                disabled={pendingAction !== null || !canUpdate}
                onClick={(event) => {
                  // Keep the dialog open so the pending state is visible while
                  // the public page is taken offline.
                  event.preventDefault();
                  void runConfirmedAction();
                }}
              >
                {pendingAction ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                {confirmCopy.actionLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-flex">
          <TabsTrigger value="overview" aria-label="Overview" className="flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4" />
            <span className="hidden sm:inline">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="components" aria-label="Components" className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            <span className="hidden sm:inline">Components</span>
          </TabsTrigger>
          <TabsTrigger value="incidents" aria-label="Status updates" className="flex items-center gap-2">
            <OctagonAlert className="h-4 w-4" />
            <span className="hidden sm:inline">Status updates</span>
          </TabsTrigger>
          <TabsTrigger value="subscribers" aria-label="Subscribers" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Subscribers</span>
          </TabsTrigger>
          <TabsTrigger value="settings" aria-label="Settings" className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            <span className="hidden sm:inline">Settings</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 lg:grid-cols-4 lg:gap-4">
            <Card className="overflow-hidden">
              <CardContent className="p-4 lg:p-6">
                <div className="flex items-center gap-3 lg:gap-4">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg lg:w-12 lg:h-12 bg-blue-100 dark:bg-blue-900/50">
                    <Layers className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xl font-bold lg:text-2xl">
                      {components.length}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Components
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="overflow-hidden">
              <CardContent className="p-4 lg:p-6">
                <div className="flex items-center gap-3 lg:gap-4">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg lg:w-12 lg:h-12 bg-orange-100 dark:bg-orange-900/50">
                    <OctagonAlert className="h-6 w-6 text-orange-500 dark:text-orange-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xl font-bold lg:text-2xl">{stats?.activeIncidents ?? 0}</div>
                    <div className="text-sm text-muted-foreground">
                      Active Incidents
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="overflow-hidden">
              <CardContent className="p-4 lg:p-6">
                <div className="flex items-center gap-3 lg:gap-4">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg lg:w-12 lg:h-12 bg-green-100 dark:bg-green-900/50">
                    <Users className="h-6 w-6 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xl font-bold lg:text-2xl">{stats?.subscribers ?? 0}</div>
                    <div className="text-sm text-muted-foreground">
                      Subscribers
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="overflow-hidden">
              <CardContent className="p-4 lg:p-6">
                <div className="flex items-center gap-3 lg:gap-4">
                  <div className={`flex items-center justify-center w-10 h-10 rounded-lg lg:w-12 lg:h-12 ${
                    (stats?.failedMonitors ?? 0) > 0
                      ? "bg-red-100 dark:bg-red-900/50"
                      : "bg-gray-100 dark:bg-gray-800/50"
                  }`}>
                    <AlertTriangle className={`h-6 w-6 ${
                      (stats?.failedMonitors ?? 0) > 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-gray-400 dark:text-gray-500"
                    }`} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xl font-bold lg:text-2xl">{stats?.failedMonitors ?? 0}</div>
                    <div className="text-sm text-muted-foreground">
                      Failed Monitors
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Linked Monitors Section */}
          <Card>
            <CardContent className="p-4 lg:p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-muted-foreground" />
                  <h3 className="text-lg font-semibold">Linked Monitors</h3>
                </div>
                <Badge variant="secondary">
                  {(() => {
                    // Collect all monitor IDs from all components
                    const allMonitorIds = components.flatMap((c) =>
                      c.monitors.map((m) => m.id)
                    );

                    // Filter unique monitor IDs
                    const uniqueMonitorIds = [...new Set(allMonitorIds)];

                    return uniqueMonitorIds.length;
                  })()}{" "}
                  monitors
                </Badge>
              </div>
              {(() => {
                // Collect all monitor IDs from all components
                const allMonitorIds = components.flatMap((c) =>
                  c.monitors.map((m) => m.id)
                );

                // Filter unique monitor IDs
                const uniqueMonitorIds = [...new Set(allMonitorIds)];

                return uniqueMonitorIds.length;
              })() === 0 ? (
                <div className="text-center py-12 border-2 border-dashed rounded-lg bg-muted/20">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted mb-4">
                    <Activity className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <h4 className="text-base font-semibold mb-1">
                    No monitors linked yet
                  </h4>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    Link monitors to components in the Components tab to track
                    their status
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <DataTable
                    columns={statusPageColumns}
                    data={(() => {
                      // Collect all monitors from all components
                      const allMonitors = components.flatMap((c) =>
                        c.monitors.map((monitor) => toOverviewMonitor(monitor, c.name))
                      );

                      // Filter out duplicate monitors by ID
                      const uniqueMonitors = allMonitors.filter(
                        (monitor, index, self) =>
                          index === self.findIndex((m) => m.id === monitor.id)
                      );

                      return uniqueMonitors;
                    })()}
                    isLoading={false}
                    onRowClick={(row) =>
                      router.push(`/monitors/${row.original.id}`)
                    }
                    hideToolbar={true}
                    pageSize={5}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="components" className="space-y-4">
          <ComponentsTab
            statusPageId={statusPage.id}
            monitors={monitors}
            canUpdate={canUpdate}
            onDataChange={onDataChange}
          />
        </TabsContent>

        <TabsContent value="incidents" className="space-y-4">
          <IncidentsTab
            statusPageId={statusPage.id}
            components={components.map((c) => ({ id: c.id, name: c.name }))}
            canUpdate={canUpdate}
            onDataChange={onDataChange}
          />
        </TabsContent>

        <TabsContent value="subscribers" className="space-y-4">
          <SubscribersTab statusPageId={statusPage.id} />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <SettingsTab
            statusPage={statusPage}
            canUpdate={canUpdate}
            statusPageDomain={statusPageDomain}
            statusPageCnameTarget={statusPageCnameTarget}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
