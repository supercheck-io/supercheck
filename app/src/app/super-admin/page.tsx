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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TableBadge } from "@/components/ui/table-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Users,
  Crown,
  Building2,
  FolderOpen,
  LayoutDashboard,
  ListOrdered,
  UserPlus,
  UserCheck,
  CalendarClock,
  Code,
  ClipboardList,
  Globe,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useBreadcrumbs } from "@/components/breadcrumb-context";
import { TabLoadingSpinner } from "@/components/ui/table-skeleton";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";
import { Loader2 } from "lucide-react";
import { FormInput } from "@/components/ui/form-input";
import {
  createUserSchema,
  type CreateUserFormData,
} from "@/lib/validations/user";
import { z } from "zod";

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

  const allowedTabs = ["overview", "users", "organizations", "queues"];
  const requestedTab = searchParams.get("tab");
  const safeTab = requestedTab && allowedTabs.includes(requestedTab)
    ? requestedTab
    : "overview";

  const [activeTab, setActiveTab] = useState(safeTab);

  const [showCreateUserDialog, setShowCreateUserDialog] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "project_viewer" });

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

  const handleCreateUser = async () => {
    // Validate form data with Zod
    const userData: CreateUserFormData = {
      name: newUser.name.trim(),
      email: newUser.email.trim(),
      password: newUser.password,
    };

    try {
      createUserSchema.parse(userData);
    } catch (error) {
      if (error instanceof z.ZodError) {
        if (error.errors && error.errors.length > 0) {
          toast.error(error.errors[0].message);
          return;
        }
      }
      toast.error("Please fix the form errors");
      return;
    }

    setCreatingUser(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: userData.name,
          email: userData.email,
          password: userData.password,
          role: newUser.role,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success("User created successfully");
        setShowCreateUserDialog(false);
        setNewUser({ name: "", email: "", password: "", role: "project_viewer" });
        invalidateUsers();
        invalidateStats();
      } else {
        toast.error(data.error || "Failed to create user");
      }
    } catch (error) {
      console.error("Error creating user:", error);
      toast.error("Failed to create user");
    } finally {
      setCreatingUser(false);
    }
  };

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <SuperCheckLoading size="md" message="Loading admin dashboard..." />
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
    <div className="overflow-hidden">
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent className="p-6 overflow-hidden">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Super Admin</h1>
              <p className="text-muted-foreground text-sm">
                Manage system users, organizations, and platform-wide operational data.
              </p>
            </div>
            <TableBadge tone="indigo" className="ring-1 ring-indigo-500/35">
              <Crown className="mr-1.5 h-3.5 w-3.5" />
              System-wide access
            </TableBadge>
          </div>

          <Tabs
            value={activeTab}
            className="space-y-4"
            onValueChange={handleTabChange}
          >
            <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-flex">
              <TabsTrigger value="overview" className="flex items-center gap-2">
                <LayoutDashboard className="h-4 w-4" />
                <span className="hidden sm:inline">Overview</span>
              </TabsTrigger>
              <TabsTrigger value="users" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <span className="hidden sm:inline">Users</span>
              </TabsTrigger>
              <TabsTrigger
                value="organizations"
                className="flex items-center gap-2"
              >
                <Building2 className="h-4 w-4" />
                <span className="hidden sm:inline">Organizations</span>
              </TabsTrigger>
              <TabsTrigger value="queues" className="flex items-center gap-2">
                <ListOrdered className="h-4 w-4" />
                <span className="hidden sm:inline">Queues</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
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
                  description="Active jobs"
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
                  description="Active monitors"
                  icon={Globe}
                  variant="success"
                  className="h-full"
                  metaInline
                />
                <StatsCard
                  title="Total Runs"
                  value={stats.organizations.totalRuns}
                  description="Test executions"
                  icon={ClipboardList}
                  variant="purple"
                  className="h-full"
                  metaInline
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="h-full">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">User Statistics</CardTitle>
                    <CardDescription>Account overview and moderation signals</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Total Users</span>
                      <TableBadge tone="info">{stats.users.totalUsers.toLocaleString()}</TableBadge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Active Users</span>
                      <TableBadge tone="success">{stats.users.activeUsers.toLocaleString()}</TableBadge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Banned Users</span>
                      <TableBadge tone="danger">{stats.users.bannedUsers.toLocaleString()}</TableBadge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">New This Month</span>
                      <TableBadge tone="purple">+{stats.users.newUsersThisMonth.toLocaleString()}</TableBadge>
                    </div>
                  </CardContent>
                </Card>

                <Card className="h-full">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Platform Activity</CardTitle>
                    <CardDescription>Key cross-organization resource totals</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Organizations</span>
                      <TableBadge tone="info">{stats.organizations.totalOrganizations.toLocaleString()}</TableBadge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Projects</span>
                      <TableBadge tone="success">{stats.organizations.totalProjects.toLocaleString()}</TableBadge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Scheduled Jobs</span>
                      <TableBadge tone="warning">{stats.organizations.totalJobs.toLocaleString()}</TableBadge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Test Executions</span>
                      <TableBadge tone="purple">{stats.organizations.totalRuns.toLocaleString()}</TableBadge>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="users" className="space-y-4">

              {/* Create User Dialog */}
              <Dialog
                open={showCreateUserDialog}
                onOpenChange={setShowCreateUserDialog}
              >
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <UserPlus className="h-5 w-5" />
                      Create New User
                    </DialogTitle>
                    <DialogDescription>
                      Add a new user to the system. They will receive an email
                      with login instructions.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <FormInput
                      id="name"
                      label="Name"
                      value={newUser.name}
                      onChange={(e) =>
                        setNewUser({ ...newUser, name: e.target.value })
                      }
                      placeholder="Enter full name"
                      maxLength={100}
                      showCharacterCount={false}
                    />
                    <FormInput
                      id="email"
                      label="Email"
                      type="email"
                      value={newUser.email}
                      onChange={(e) =>
                        setNewUser({ ...newUser, email: e.target.value })
                      }
                      placeholder="user@example.com"
                      maxLength={255}
                      showCharacterCount={false}
                    />
                    <FormInput
                      id="password"
                      label="Password"
                      type="password"
                      value={newUser.password}
                      onChange={(e) =>
                        setNewUser({ ...newUser, password: e.target.value })
                      }
                      placeholder="Min 8 chars, uppercase, lowercase, number"
                      maxLength={128}
                      showCharacterCount={false}
                    />
                  </div>
                  <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                      variant="outline"
                      onClick={() => setShowCreateUserDialog(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleCreateUser}
                      disabled={
                        creatingUser ||
                        !newUser.name.trim() ||
                        !newUser.email.trim() ||
                        !newUser.password.trim()
                      }
                    >
                      {creatingUser ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        "Create User"
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {usersLoading && users.length === 0 ? (
                <TabLoadingSpinner message="Loading users..." />
              ) : (
                <UserTable
                  users={users}
                  onUserUpdate={() => {
                    invalidateUsers();
                    invalidateStats();
                  }}
                  onCreateUser={() => setShowCreateUserDialog(true)}
                />
              )}
            </TabsContent>

            <TabsContent value="organizations" className="space-y-4">
              {orgsLoading && organizations.length === 0 ? (
                <TabLoadingSpinner message="Loading organizations..." />
              ) : (
                <OrgTable organizations={organizations} />
              )}
            </TabsContent>

            <TabsContent value="queues">
              <div className="rounded-lg border bg-background overflow-hidden">
                {iframeError ? (
                  <div
                    className="flex justify-center items-center"
                    style={{
                      height: "calc(100vh - 280px)",
                      minHeight: "400px",
                    }}
                  >
                    <div className="flex flex-col items-center space-y-4 text-center px-4">
                      <AlertCircle className="h-10 w-10 text-destructive" />
                      <div>
                        <h3 className="text-lg font-semibold">
                          Failed to load Queue Dashboard
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          The dashboard may be unavailable or taking too long to
                          respond.
                        </p>
                      </div>
                      <Button variant="outline" onClick={handleIframeRefresh}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Try Again
                      </Button>
                    </div>
                  </div>
                ) : !iframeLoaded ? (
                  <div
                    className="flex justify-center items-center"
                    style={{
                      height: "calc(100vh - 280px)",
                      minHeight: "400px",
                    }}
                  >
                    <SuperCheckLoading size="md" message="Loading Queue Dashboard..." />
                  </div>
                ) : null}

                <iframe
                  ref={iframeRef}
                  src="/api/admin/queues/"
                  className="w-full"
                  style={{
                    height: "calc(100vh - 280px)",
                    minHeight: "400px",
                    display: iframeLoaded && !iframeError ? "block" : "none",
                  }}
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
