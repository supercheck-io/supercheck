"use client";

import React, { useState } from "react";
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
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { getStatusPageUrl } from "@/lib/domain-utils";
import { DataTable } from "@/components/monitors/data-table";
import { statusPageColumns } from "@/components/monitors/status-page-columns";
import type { Monitor } from "@/components/monitors/schema";

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
  notificationsFromEmail: string | null;
  notificationsEmailFooter: string | null;
  customDomain: string | null;
  customDomainVerified: boolean | null;
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

type StatusPageMonitor = {
  id: string;
  name: string;
  type: string;
  status?: string;
  target?: string;
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

type StatusPageDetailProps = {
  statusPage: StatusPage;
  monitors: StatusPageMonitor[];
  components: Component[];
  canUpdate: boolean;
};

export function StatusPageDetail({
  statusPage,
  monitors,
  components,
  canUpdate,
}: StatusPageDetailProps) {
  const router = useRouter();
  const [isPublishing, setIsPublishing] = useState(false);

  const handleCopyUrl = () => {
    const url = getStatusPageUrl(statusPage.subdomain);
    navigator.clipboard.writeText(url);
    toast.success("URL copied to clipboard", {
      description: url,
    });
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      const result = await publishStatusPage(statusPage.id);
      if (result.success) {
        toast.success("Status page published successfully", {
          description: `Your status page is now publicly accessible at ${getStatusPageUrl(
            statusPage.subdomain
          )}`,
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

  const handleUnpublish = async () => {
    setIsPublishing(true);
    try {
      const result = await unpublishStatusPage(statusPage.id);
      if (result.success) {
        toast.success("Status page unpublished successfully", {
          description: "Your status page is no longer publicly accessible",
        });
        router.refresh();
      } else {
        toast.error("Failed to unpublish status page", {
          description: result.message,
        });
      }
    } catch (error) {
      console.error("Error unpublishing status page:", error);
      toast.error("Failed to unpublish status page", {
        description: "An unexpected error occurred",
      });
    } finally {
      setIsPublishing(false);
    }
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
        <div className="flex items-start justify-between mb-6">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-semibold">{statusPage.name}</h1>
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
              <p className="text-lg text-muted-foreground mb-2">
                {statusPage.headline}
              </p>
            )}
            {statusPage.pageDescription && (
              <p className="text-sm text-muted-foreground">
                {statusPage.pageDescription}
              </p>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-3">
              <Tally4 className="h-4 w-4 flex-shrink-0 !text-green-600" />
              <span className="font-mono text-sm">
                {getStatusPageUrl(statusPage.subdomain)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={handleCopyUrl}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/status-pages/${statusPage.id}/public`}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Preview
              </Link>
            </Button>
            {statusPage.status === "published" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleUnpublish}
                disabled={isPublishing || !canUpdate}
                title={
                  !canUpdate ? "You don't have permission to unpublish" : ""
                }
              >
                {isPublishing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <EyeOff className="h-4 w-4 mr-2" />
                )}
                Unpublish
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handlePublish}
                disabled={isPublishing || !canUpdate}
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

        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="incidents">Incidents</TabsTrigger>
          <TabsTrigger value="subscribers">Subscribers</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="p-6">
                <div className="text-2xl font-bold">{components.length}</div>
                <div className="text-sm text-muted-foreground">Components</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-2xl font-bold">0</div>
                <div className="text-sm text-muted-foreground">
                  Active Incidents
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-2xl font-bold">0</div>
                <div className="text-sm text-muted-foreground">Subscribers</div>
              </CardContent>
            </Card>
          </div>

          {/* Linked Monitors Section */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Linked Monitors</h3>
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
                <div className="text-center py-8 text-sm text-muted-foreground">
                  <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No monitors linked yet</p>
                  <p className="mt-1">
                    Link monitors to components in the Components tab
                  </p>
                </div>
              ) : (
                <DataTable
                  columns={statusPageColumns}
                  data={(() => {
                    // Collect all monitors from all components
                    const allMonitors = components.flatMap((c) =>
                      c.monitors.map(
                        (monitor) =>
                          ({
                            ...monitor,
                            id: monitor.id,
                            name: monitor.name,
                            type: monitor.type,
                            status: monitor.status || "pending",
                            target: monitor.target || "", // Use the target field from monitor data
                            frequencyMinutes: 5, // Required field but not available in StatusPageMonitor
                            enabled: true, // Required field but not available in StatusPageMonitor
                            createdAt: new Date().toISOString(), // Required field but not available in StatusPageMonitor
                            updatedAt: new Date().toISOString(), // Required field but not available in StatusPageMonitor
                            componentName: c.name, // Add component name for reference
                          } as Monitor & { componentName: string })
                      )
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
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="components" className="space-y-4">
          <ComponentsTab
            statusPageId={statusPage.id}
            monitors={monitors}
            canUpdate={canUpdate}
          />
        </TabsContent>

        <TabsContent value="incidents" className="space-y-4">
          <IncidentsTab
            statusPageId={statusPage.id}
            components={components.map((c) => ({ id: c.id, name: c.name }))}
          />
        </TabsContent>

        <TabsContent value="subscribers" className="space-y-4">
          <SubscribersTab statusPageId={statusPage.id} />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <SettingsTab statusPage={statusPage} canUpdate={canUpdate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
