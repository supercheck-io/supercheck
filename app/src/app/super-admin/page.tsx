"use client";

import React, { useState, useEffect } from "react";
import { StatsCard } from "@/components/admin/stats-card";
import { UserTable } from "@/components/admin/user-table";
import { OrgTable } from "@/components/admin/org-table";
import type { AdminUser } from "@/components/admin/user-columns";
import type { AdminOrganization } from "@/components/admin/org-columns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  Building2,
  FolderOpen,
  LayoutDashboard,
  ListOrdered,
  UserPlus,
  UserCheck,
  CalendarClock,
  Code,
  ClipboardList,
  Activity,
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

interface SystemStats {
  users: {
    totalUsers: number;
    newUsersThisMonth: number;
    activeUsers: number;
    bannedUsers: number;
  };
  organizations: {
    totalOrganizations: number;
    totalProjects: number;
    totalJobs: number;
    totalTests: number;
    totalMonitors: number;
    totalRuns: number;
  };
}

export default function AdminDashboard() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Users tab state
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [showCreateUserDialog, setShowCreateUserDialog] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    password: "",
    role: "project_viewer",
  });
  const [usersPagination, setUsersPagination] = useState({
    limit: 10000, // Fetch all users for client-side pagination
    offset: 0,
    hasMore: false,
    total: 0,
  });

  // Organizations tab state
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgsPagination, setOrgsPagination] = useState({
    limit: 10000, // Fetch all organizations for client-side pagination
    offset: 0,
    hasMore: false,
    total: 0,
  });

  // Bull Dashboard iframe state
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeError, setIframeError] = useState(false);
  const iframeTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  // Cleanup iframe timeout on unmount
  React.useEffect(() => {
    return () => {
      if (iframeTimeoutRef.current) {
        clearTimeout(iframeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    fetchStats();
  }, []);

  // Set breadcrumbs
  useEffect(() => {
    setBreadcrumbs([
      { label: "Home", href: "/", isCurrentPage: false },
      { label: "Super Admin", href: "/super-admin", isCurrentPage: true },
    ]);

    // Cleanup breadcrumbs on unmount
    return () => {
      setBreadcrumbs([]);
    };
  }, [setBreadcrumbs]);

  const handleTabChange = (value: string) => {
    if (value === "users" && users.length === 0) {
      fetchUsers();
    } else if (value === "organizations" && organizations.length === 0) {
      fetchOrganizations();
    } else if (value === "queues") {
      // Reset iframe states when switching to queues tab
      setIframeLoaded(false);
      setIframeError(false);
      // Set a timeout to detect if iframe fails to load
      if (iframeTimeoutRef.current) {
        clearTimeout(iframeTimeoutRef.current);
      }
      iframeTimeoutRef.current = setTimeout(() => {
        if (!iframeLoaded) {
          setIframeError(true);
        }
      }, 15000); // 15 second timeout
    }
  };

  const handleIframeLoad = () => {
    if (iframeTimeoutRef.current) {
      clearTimeout(iframeTimeoutRef.current);
    }
    setIframeLoaded(true);
    setIframeError(false);
  };

  const handleIframeRefresh = () => {
    setIframeLoaded(false);
    setIframeError(false);
    if (iframeRef.current) {
      iframeRef.current.src = "/api/admin/queues/";
    }
    // Reset timeout
    if (iframeTimeoutRef.current) {
      clearTimeout(iframeTimeoutRef.current);
    }
    iframeTimeoutRef.current = setTimeout(() => {
      if (!iframeLoaded) {
        setIframeError(true);
      }
    }, 15000);
  };

  const fetchStats = async () => {
    try {
      const response = await fetch("/api/admin/stats");
      const data = await response.json();

      if (data.success) {
        setStats(data.data);
      } else {
        toast.error("Failed to load statistics");
      }
    } catch (error) {
      console.error("Error fetching stats:", error);
      toast.error("Failed to load statistics");
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async (page = 0, reset = true) => {
    setUsersLoading(true);
    try {
      const offset = page * usersPagination.limit;
      const response = await fetch(
        `/api/admin/users?limit=${usersPagination.limit}&offset=${offset}`
      );
      const data = await response.json();

      if (data.success) {
        if (reset || page === 0) {
          setUsers(data.data);
        } else {
          setUsers((prev) => [...prev, ...data.data]);
        }
        setUsersPagination((prev) => ({
          ...prev,
          offset: offset,
          hasMore: data.pagination?.hasMore || false,
          total: offset + data.data.length,
        }));
      } else {
        toast.error("Failed to load users");
      }
    } catch (error) {
      console.error("Error fetching users:", error);
      toast.error("Failed to load users");
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchOrganizations = async (page = 0, reset = true) => {
    setOrgsLoading(true);
    try {
      const offset = page * orgsPagination.limit;
      const response = await fetch(
        `/api/admin/organizations?limit=${orgsPagination.limit}&offset=${offset}&stats=true`
      );
      const data = await response.json();

      if (data.success) {
        if (reset || page === 0) {
          setOrganizations(data.data);
        } else {
          setOrganizations((prev) => [...prev, ...data.data]);
        }
        setOrgsPagination((prev) => ({
          ...prev,
          offset: offset,
          hasMore: data.pagination?.hasMore || false,
          total: offset + data.data.length,
        }));
      } else {
        toast.error("Failed to load organizations");
      }
    } catch (error) {
      console.error("Error fetching organizations:", error);
      toast.error("Failed to load organizations");
    } finally {
      setOrgsLoading(false);
    }
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
        setNewUser({
          name: "",
          email: "",
          password: "",
          role: "project_viewer",
        });
        fetchUsers();
        fetchStats(); // Refresh stats
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <SuperCheckLoading size="lg" message="Loading admin dashboard..." />
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
    <div>
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent className="p-6">
          <Tabs
            defaultValue="overview"
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
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">
                    Super Admin
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    Manage system users, organizations, and view platform
                    statistics.
                  </p>
                </div>
              </div>

              {/* Primary Metrics - Full Width Row */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatsCard
                  title="Total Users"
                  value={stats.users.totalUsers}
                  description="Registered accounts"
                  icon={Users}
                  variant="primary"
                  trend={{
                    value: stats.users.newUsersThisMonth,
                    label: "new this month",
                    isPositive: true,
                  }}
                />
                <StatsCard
                  title="Active Users"
                  value={stats.users.activeUsers}
                  description="Non-banned users"
                  icon={UserCheck}
                  variant="success"
                />
                <StatsCard
                  title="Organizations"
                  value={stats.organizations.totalOrganizations}
                  description="Total organizations"
                  icon={Building2}
                  variant="purple"
                />
                <StatsCard
                  title="Projects"
                  value={stats.organizations.totalProjects}
                  description="Across all orgs"
                  icon={FolderOpen}
                  variant="cyan"
                />
              </div>

              {/* Secondary Metrics */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatsCard
                  title="Scheduled Jobs"
                  value={stats.organizations.totalJobs}
                  description="Active jobs"
                  icon={CalendarClock}
                  variant="warning"
                />
                <StatsCard
                  title="Test Cases"
                  value={stats.organizations.totalTests}
                  description="Total tests"
                  icon={Code}
                  variant="primary"
                />
                <StatsCard
                  title="Monitors"
                  value={stats.organizations.totalMonitors}
                  description="Active monitors"
                  icon={Globe}
                  variant="success"
                />
                <StatsCard
                  title="Total Runs"
                  value={stats.organizations.totalRuns}
                  description="Test executions"
                  icon={ClipboardList}
                  variant="purple"
                />
              </div>

              {/* Detailed Stats Cards */}
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-blue-500/10 p-2">
                        <Users className="h-4 w-4 text-blue-500" />
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          User Statistics
                        </CardTitle>
                        <CardDescription>
                          Account overview and status
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">
                          Total Users
                        </span>
                        <span className="font-semibold">
                          {stats.users.totalUsers}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">
                          Active Users
                        </span>
                        <span className="font-semibold text-green-600">
                          {stats.users.activeUsers}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">
                          Banned Users
                        </span>
                        <span className="font-semibold text-red-600">
                          {stats.users.bannedUsers}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <span className="text-sm text-muted-foreground">
                          New This Month
                        </span>
                        <span className="font-semibold text-blue-600">
                          +{stats.users.newUsersThisMonth}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-purple-500/10 p-2">
                        <Activity className="h-4 w-4 text-purple-500" />
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          Platform Activity
                        </CardTitle>
                        <CardDescription>
                          Resource counts across platform
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">
                          Organizations
                        </span>
                        <span className="font-semibold">
                          {stats.organizations.totalOrganizations}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">
                          Projects
                        </span>
                        <span className="font-semibold">
                          {stats.organizations.totalProjects}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2 border-b">
                        <span className="text-sm text-muted-foreground">
                          Jobs Created
                        </span>
                        <span className="font-semibold">
                          {stats.organizations.totalJobs}
                        </span>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <span className="text-sm text-muted-foreground">
                          Test Executions
                        </span>
                        <span className="font-semibold">
                          {stats.organizations.totalRuns}
                        </span>
                      </div>
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
                    fetchUsers();
                    fetchStats();
                  }}
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

            <TabsContent value="queues" className="space-y-4">
              {/* <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-2xl font-semibold">Queue Dashboard</h3>
                  <p className="text-muted-foreground text-sm">
                    Monitor and manage BullMQ job queues
                  </p>
                </div>
              </div> */}
              <div className="rounded-lg border bg-background overflow-hidden">
                {iframeError ? (
                  <div
                    className="flex justify-center items-center"
                    style={{
                      height: "calc(100vh - 250px)",
                      minHeight: "600px",
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
                      height: "calc(100vh - 250px)",
                      minHeight: "600px",
                    }}
                  >
                    <SuperCheckLoading size="lg" message="Loading Queue Dashboard..." />
                  </div>
                ) : null}

                <iframe
                  ref={iframeRef}
                  src="/api/admin/queues/"
                  className="w-full"
                  style={{
                    height: "calc(100vh - 250px)",
                    minHeight: "600px",
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
