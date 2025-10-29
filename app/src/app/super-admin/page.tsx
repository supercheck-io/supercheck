"use client";

import { useState, useEffect } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Users,
  Building2,
  FolderOpen,
  Activity,
  TrendingUp,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { useBreadcrumbs } from "@/components/breadcrumb-context";
import { AdminDashboardSkeleton } from "@/components/ui/table-skeleton";
import { Loader2 } from "lucide-react";

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
    limit: 25,
    offset: 0,
    hasMore: false,
    total: 0,
  });

  // Organizations tab state
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgsPagination, setOrgsPagination] = useState({
    limit: 25,
    offset: 0,
    hasMore: false,
    total: 0,
  });

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
    }
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
    if (
      !newUser.name.trim() ||
      !newUser.email.trim() ||
      !newUser.password.trim()
    ) {
      toast.error("All fields are required");
      return;
    }

    setCreatingUser(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newUser),
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
    return <AdminDashboardSkeleton />;
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
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="users">Users</TabsTrigger>
              <TabsTrigger value="organizations">Organizations</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-semibold">Super Admin</h2>
                  <p className="text-muted-foreground text-sm">
                    Manage system users, organizations, and view platform
                    statistics.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatsCard
                  title="Total Users"
                  value={stats.users.totalUsers}
                  description="All registered users"
                  icon={Users}
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
                  icon={Activity}
                />
                <StatsCard
                  title="Organizations"
                  value={stats.organizations.totalOrganizations}
                  description="Total organizations"
                  icon={Building2}
                />
                <StatsCard
                  title="Projects"
                  value={stats.organizations.totalProjects}
                  description="All projects"
                  icon={FolderOpen}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatsCard
                  title="Jobs"
                  value={stats.organizations.totalJobs}
                  description="Scheduled jobs"
                  icon={Calendar}
                />
                <StatsCard
                  title="Tests"
                  value={stats.organizations.totalTests}
                  description="Test cases"
                  icon={Activity}
                />
                <StatsCard
                  title="Monitors"
                  value={stats.organizations.totalMonitors}
                  description="Active monitors"
                  icon={TrendingUp}
                />
                <StatsCard
                  title="Total Runs"
                  value={stats.organizations.totalRuns}
                  description="Test executions"
                  icon={Activity}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>User Statistics</CardTitle>
                    <CardDescription>
                      Overview of user accounts and status
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Total Users
                      </span>
                      <span className="font-medium">
                        {stats.users.totalUsers}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Active Users
                      </span>
                      <span className="font-medium text-green-600">
                        {stats.users.activeUsers}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Banned Users
                      </span>
                      <span className="font-medium text-red-600">
                        {stats.users.bannedUsers}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        New This Month
                      </span>
                      <span className="font-medium text-blue-600">
                        {stats.users.newUsersThisMonth}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Platform Activity</CardTitle>
                    <CardDescription>
                      Total counts across the platform
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Organizations
                      </span>
                      <span className="font-medium">
                        {stats.organizations.totalOrganizations}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Projects
                      </span>
                      <span className="font-medium">
                        {stats.organizations.totalProjects}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Jobs Created
                      </span>
                      <span className="font-medium">
                        {stats.organizations.totalJobs}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Test Executions
                      </span>
                      <span className="font-medium">
                        {stats.organizations.totalRuns}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="users" className="space-y-4">
              <Dialog
                open={showCreateUserDialog}
                onOpenChange={setShowCreateUserDialog}
              >
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New User</DialogTitle>
                    <DialogDescription>
                      Add a new user to the system.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="name" className="text-right">
                        Name
                      </Label>
                      <Input
                        id="name"
                        value={newUser.name}
                        onChange={(e) =>
                          setNewUser({ ...newUser, name: e.target.value })
                        }
                        className="col-span-3"
                        placeholder="John Doe"
                      />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="email" className="text-right">
                        Email
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        value={newUser.email}
                        onChange={(e) =>
                          setNewUser({ ...newUser, email: e.target.value })
                        }
                        className="col-span-3"
                        placeholder="john@example.com"
                      />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="password" className="text-right">
                        Password
                      </Label>
                      <Input
                        id="password"
                        type="password"
                        value={newUser.password}
                        onChange={(e) =>
                          setNewUser({ ...newUser, password: e.target.value })
                        }
                        className="col-span-3"
                        placeholder="Password"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={handleCreateUser} disabled={creatingUser}>
                      {creatingUser ? "Creating..." : "Create User"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {usersLoading && users.length === 0 ? (
                <div className="flex justify-center items-center h-64">
                  <div className="flex items-center space-x-2">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="text-muted-foreground">
                      Loading users...
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <UserTable
                    users={users}
                    onUserUpdate={() => {
                      fetchUsers();
                      fetchStats();
                    }}
                  />
                  {usersPagination.hasMore && (
                    <div className="flex justify-center pt-4">
                      <Button
                        variant="outline"
                        onClick={() =>
                          fetchUsers(
                            Math.floor(
                              usersPagination.offset / usersPagination.limit
                            ) + 1,
                            false
                          )
                        }
                        disabled={usersLoading}
                      >
                        Load More Users
                      </Button>
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="organizations" className="space-y-4">
              {orgsLoading && organizations.length === 0 ? (
                <div className="flex justify-center items-center h-64">
                  <div className="flex items-center space-x-2">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="text-muted-foreground">
                      Loading organizations...
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <OrgTable organizations={organizations} />
                  {orgsPagination.hasMore && (
                    <div className="flex justify-center pt-4">
                      <Button
                        variant="outline"
                        onClick={() =>
                          fetchOrganizations(
                            Math.floor(
                              orgsPagination.offset / orgsPagination.limit
                            ) + 1,
                            false
                          )
                        }
                        disabled={orgsLoading}
                      >
                        Load More Organizations
                      </Button>
                    </div>
                  )}
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
