"use client";

import React, { useState, useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { StatsCard } from "@/components/admin/stats-card";
import { UserTable } from "@/components/admin/user-table";
import { OrgTable } from "@/components/admin/org-table";
import {
  useSuperAdminStats,
  useSuperAdminUsers,
  useSuperAdminOrganizations,
  useSuperAdminDataInvalidation,
} from "@/hooks/use-super-admin";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { SectionTabs, type SectionTab } from "@/components/shared/section-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Users,
  Building2,
  FolderOpen,
  LayoutDashboard,
  ListOrdered,
  UserCheck,
  CalendarClock,
  Code,
  ClipboardList,
  Globe,
  RefreshCw,
  AlertCircle,
  MapPin,
} from "lucide-react";
import { useBreadcrumbs } from "@/components/breadcrumb-context";
import { TabLoadingSpinner } from "@/components/ui/table-skeleton";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import { cn } from "@/lib/utils";
import { LocationsTable } from "@/components/admin/locations-table";

const TABS: SectionTab[] = [
  { value: "overview", label: "Overview", icon: LayoutDashboard },
  { value: "users", label: "Users", icon: Users },
  { value: "organizations", label: "Organizations", icon: Building2 },
  { value: "locations", label: "Locations", icon: MapPin },
  { value: "queues", label: "Queues", icon: ListOrdered },
];

export default function AdminDashboard() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isMounted = useSyncExternalStore(
    () => () => { },
    () => true,
    () => false
  );

  const { stats, isLoading: statsLoading } = useSuperAdminStats();
  const { users, isLoading: usersLoading } = useSuperAdminUsers();
  const { organizations, isLoading: orgsLoading } = useSuperAdminOrganizations();
  const { invalidateStats, invalidateUsers } = useSuperAdminDataInvalidation();

  const hasData = stats !== null;
  const isInitialLoading = !isMounted || (!hasData && statsLoading);

  const allowedTabs = ["overview", "users", "organizations", "locations", "queues"];
  const requestedTab = searchParams.get("tab");
  const safeTab = requestedTab && allowedTabs.includes(requestedTab)
    ? requestedTab
    : "overview";

  const [activeTab, setActiveTab] = useState(safeTab);
  const isQueuesTab = activeTab === "queues";

  // Bull Dashboard iframe state
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeError, setIframeError] = useState(false);
  const iframeLoadedRef = React.useRef(false);
  const iframeTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  React.useEffect(() => {
    return () => {
      if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Home", href: "/", isCurrentPage: false },
      { label: "Super Admin", href: "/super-admin", isCurrentPage: true },
    ]);
    return () => setBreadcrumbs([]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    setActiveTab(safeTab);
  }, [safeTab]);

  const handleTabChange = (value: string) => {
    if (!allowedTabs.includes(value)) {
      return;
    }

    setActiveTab(value);

    const params = new URLSearchParams(searchParams.toString());
    if (value === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", value);
    }

    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(nextUrl, { scroll: false });

    if (value === "queues") {
      iframeLoadedRef.current = false;
      setIframeLoaded(false);
      setIframeError(false);
      if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
      iframeTimeoutRef.current = setTimeout(() => {
        if (!iframeLoadedRef.current) setIframeError(true);
      }, 15000);
    }
  };

  const handleIframeLoad = () => {
    if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
    iframeLoadedRef.current = true;
    setIframeLoaded(true);
    setIframeError(false);
  };

  const handleIframeRefresh = () => {
    iframeLoadedRef.current = false;
    setIframeLoaded(false);
    setIframeError(false);
    if (iframeRef.current) iframeRef.current.src = "/api/admin/queues/";
    if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
    iframeTimeoutRef.current = setTimeout(() => {
      if (!iframeLoadedRef.current) setIframeError(true);
    }, 15000);
  };

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <SupercheckLoading size="md" message="Loading admin dashboard..." />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex-1 space-y-4 p-4 pt-6">
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">
            Failed to load admin dashboard
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      {...(isQueuesTab ? { "data-fit-viewport": "" } : {})}
      className={cn("flex min-h-0 flex-1 flex-col", isQueuesTab && "lg:overflow-auto")}
    >
      <Card
        className={cn(
          "m-4 shadow-sm transition-shadow duration-200 hover:shadow-md",
          isQueuesTab ? "flex min-h-0 flex-1 flex-col lg:min-h-[400px]" : "shrink-0",
        )}
      >
        <CardContent
          className={cn("p-6", isQueuesTab && "flex min-h-0 flex-1 flex-col")}
        >
      <Tabs
        value={activeTab}
        className={cn("w-full space-y-4", isQueuesTab && "flex min-h-0 flex-1 flex-col")}
        onValueChange={handleTabChange}
      >
        <PageHeader
          title="Super Admin"
          actions={
            <SectionTabs
              tabs={TABS}
              value={activeTab}
              onValueChange={handleTabChange}
              collapseBelow="lg"
            />
          }
        />

        <TabsContent value="overview" className="mt-0 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 auto-rows-fr">
            <StatsCard
              title="Total Users"
              value={stats.users.totalUsers}
              description={`${stats.users.newUsersThisMonth.toLocaleString()} new this month`}
              icon={Users}
              variant="primary"
              className="h-full"
              metaInline
            />
            <StatsCard
              title="Active Users"
              value={stats.users.activeUsers}
              description={`${stats.users.bannedUsers.toLocaleString()} banned users`}
              icon={UserCheck}
              variant="success"
              className="h-full"
              metaInline
            />
            <StatsCard
              title="Organizations"
              value={stats.organizations.totalOrganizations}
              description="Total organizations"
              icon={Building2}
              variant="purple"
              className="h-full"
              metaInline
            />
            <StatsCard
              title="Projects"
              value={stats.organizations.totalProjects}
              description="Across all organizations"
              icon={FolderOpen}
              variant="cyan"
              className="h-full"
              metaInline
            />
            <StatsCard
              title="Scheduled Jobs"
              value={stats.organizations.totalJobs}
              description="All jobs"
              icon={CalendarClock}
              variant="warning"
              className="h-full"
              metaInline
            />
            <StatsCard
              title="Test Cases"
              value={stats.organizations.totalTests}
              description="Total tests"
              icon={Code}
              variant="primary"
              className="h-full"
              metaInline
            />
            <StatsCard
              title="Monitors"
              value={stats.organizations.totalMonitors}
              description="All monitors"
              icon={Globe}
              variant="success"
              className="h-full"
              metaInline
            />
            <StatsCard
              title="Runs"
              value={stats.organizations.totalRuns}
              description="All test and job runs"
              icon={ClipboardList}
              variant="purple"
              className="h-full"
              metaInline
            />
          </div>
        </TabsContent>

        <TabsContent value="users" className="mt-0 space-y-4">

          {usersLoading && users.length === 0 ? (
            <TabLoadingSpinner message="Loading users..." />
          ) : (
            <UserTable
              users={users}
              onUserUpdate={() => {
                invalidateUsers();
                invalidateStats();
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="organizations" className="mt-0 space-y-4">
          {orgsLoading && organizations.length === 0 ? (
            <TabLoadingSpinner message="Loading organizations..." />
          ) : (
            <OrgTable organizations={organizations} />
          )}
        </TabsContent>

        <TabsContent value="locations" className="mt-0 space-y-4">
          <LocationsTable />
        </TabsContent>

        <TabsContent
          value="queues"
          className="mt-0 flex min-h-0 flex-1 flex-col"
        >
          <div className="relative h-[calc(100svh-22rem)] min-h-[400px] overflow-hidden rounded-lg border bg-background lg:h-auto lg:flex-1">
            {iframeError ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center space-y-4 px-4 text-center">
                  <AlertCircle className="h-10 w-10 text-destructive" />
                  <div>
                    <h3 className="text-lg font-semibold">
                      Failed to load Queue Dashboard
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The dashboard may be unavailable or taking too long to
                      respond.
                    </p>
                  </div>
                  <Button variant="outline" onClick={handleIframeRefresh}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Try Again
                  </Button>
                </div>
              </div>
            ) : !iframeLoaded ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <SupercheckLoading size="md" message="Loading Queue Dashboard..." />
              </div>
            ) : null}

            <iframe
              ref={iframeRef}
              src="/api/admin/queues/"
              className={cn(
                "absolute inset-0 h-full w-full",
                (!iframeLoaded || iframeError) && "hidden",
              )}
              title="Queue Dashboard"
              onLoad={handleIframeLoad}
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          </div>
        </TabsContent>
      </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
