"use client";

import { useState, useEffect, Suspense, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { StatsCard } from "@/components/admin/stats-card";
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
  FolderOpen,
  Users,
  Building2,
  AlertTriangle,
  LayoutDashboard,
  DollarSign,
  UserSearch,
  CalendarClock,
  Code,
  Globe,
  ClipboardList,
  Terminal,
  Mail,
} from "lucide-react";
import { toast } from "sonner";
import { AuditLogsTable } from "@/components/admin/audit-logs-table";
import { CliTokensTable } from "@/components/admin/cli-tokens-table";
import { MembersTable } from "@/components/org-admin/members-table";
import { ProjectsTable } from "@/components/org-admin/projects-table";
import { SubscriptionTab } from "@/components/org-admin/subscription-tab";
import { MemberAccessDialog } from "@/components/members/MemberAccessDialog";
import { FormInput } from "@/components/ui/form-input";
import {
  createProjectSchema,
  type CreateProjectFormData,
} from "@/lib/validations/project";
import { useBreadcrumbs } from "@/components/breadcrumb-context";
import { TabLoadingSpinner } from "@/components/ui/table-skeleton";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";
import { Loader2 } from "lucide-react";
import {
  canCreateProjects,
  canInviteMembers,
  canManageProject,
} from "@/lib/rbac/client-permissions";
import { normalizeRole, roleToDisplayName } from "@/lib/rbac/role-normalizer";
import { z } from "zod";
import { useAppConfig } from "@/hooks/use-app-config";
import { cn } from "@/lib/utils";
// Use React Query hooks for cached data fetching
import {
  useOrgStats,
  useOrgDetails,
  useOrgMembers,
  useOrgProjects,
  useOrgDataInvalidation,
} from "@/hooks/use-organization";

interface OrgStats {
  projects: number;
  jobs: number;
  tests: number;
  monitors: number;
  runs: number;
  members: number;
}

interface OrgMember {
  id: string;
  name: string;
  email: string;
  role:
  | "org_owner"
  | "org_admin"
  | "project_admin"
  | "project_editor"
  | "project_viewer";
  joinedAt: string;
}

interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  inviterName: string;
  inviterEmail: string;
}

interface Project {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  isDefault: boolean;
  status: "active" | "archived" | "deleted";
  createdAt: string;
  membersCount: number;
}

interface OrgDetails {
  id: string;
  name: string;
  slug?: string;
  logo?: string;
  createdAt: string;
}

interface ProjectMember {
  user: {
    id: string;
    name: string;
    email: string;
    image?: string;
  };
  role: string;
}

export default function OrgAdminDashboard() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[400px] items-center justify-center">
          <SuperCheckLoading size="md" message="Loading organization..." />
        </div>
      }
    >
      <OrgAdminDashboardContent />
    </Suspense>
  );
}

function OrgAdminDashboardContent() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isMounted = useSyncExternalStore(
    () => () => { },
    () => true,
    () => false
  );

  const { isCloudHosted } = useAppConfig();

  const allowedTabs = isCloudHosted
    ? ["overview", "projects", "members", "cli-tokens", "audit", "subscription"]
    : ["overview", "projects", "members", "cli-tokens", "audit"];

  const requestedTab = searchParams.get("tab");
  const safeTab = requestedTab && allowedTabs.includes(requestedTab)
    ? requestedTab
    : "overview";

  const [activeTab, setActiveTab] = useState(safeTab);

  const { stats: orgStats, isLoading: statsLoading } = useOrgStats();
  const { details: orgDetails, isLoading: detailsLoading } = useOrgDetails();
  const { members, invitations, currentUserRole, isLoading: membersLoading } = useOrgMembers();
  const { projects: orgProjects, isLoading: projectsLoading } = useOrgProjects();
  const { invalidateStats, invalidateMembers, invalidateProjects } = useOrgDataInvalidation();

  const hasData = orgStats !== null && orgDetails !== null;
  const isInitialLoading = !isMounted || (!hasData && (statsLoading || detailsLoading));

  const stats: OrgStats | null = orgStats ? {
    projects: orgStats.projectCount,
    jobs: orgStats.jobCount || 0,
    tests: orgStats.testCount || 0,
    monitors: orgStats.monitorCount || 0,
    runs: orgStats.runCount || 0,
    members: orgStats.memberCount,
  } : null;

  // Note: membersCount is not available from the API currently.
  // The Project interface requires it, but the /api/projects endpoint
  // doesn't return per-project member counts. Setting to 0 for now.
  // TODO: Add members count to /api/projects response if needed.
  const projects: Project[] = orgProjects.map(p => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    isDefault: p.isDefault,
    status: "active" as const,
    createdAt: p.createdAt,
    membersCount: 0,
  }));

  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [showCreateProjectDialog, setShowCreateProjectDialog] = useState(false);
  const [showEditProjectDialog, setShowEditProjectDialog] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [updatingProject, setUpdatingProject] = useState(false);
  const [newProject, setNewProject] = useState({ name: "", description: "", isDefault: false });
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Home", href: "/", isCurrentPage: false },
      { label: "Organization Admin", href: "/org-admin", isCurrentPage: true },
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
  };

  const handleCreateProject = async (formData?: CreateProjectFormData) => {
    const projectData = formData || {
      name: newProject.name.trim(),
      description: newProject.description.trim(),
    };

    // Validate form data
    try {
      createProjectSchema.parse(projectData);
    } catch (error) {
      if (error instanceof Error) {
        const zodError = error as z.ZodError;
        if (zodError.errors && zodError.errors.length > 0) {
          toast.error(zodError.errors[0].message);
          return;
        }
      }
      toast.error("Please fix the form errors");
      return;
    }

    setCreatingProject(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: projectData.name,
          description: projectData.description,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success("Project created successfully");
        setShowCreateProjectDialog(false);
        setNewProject({
          name: "",
          description: "",
          isDefault: false,
        });
        invalidateProjects();
        invalidateStats();
      } else {
        toast.error(data.error || "Failed to create project");
      }
    } catch (error) {
      console.error("Error creating project:", error);
      toast.error("Failed to create project");
    } finally {
      setCreatingProject(false);
    }
  };

  const handleEditProject = (project: Project) => {
    setEditingProject(project);
    setNewProject({
      name: project.name,
      description: project.description || "",
      isDefault: project.isDefault,
    });
    setShowEditProjectDialog(true);
  };

  const handleUpdateProject = async () => {
    if (!editingProject) return;

    const projectData = {
      name: newProject.name.trim(),
      description: newProject.description.trim(),
    };

    // Validate form data
    try {
      createProjectSchema.parse(projectData);
    } catch (error) {
      if (error instanceof Error) {
        const zodError = error as z.ZodError;
        if (zodError.errors && zodError.errors.length > 0) {
          toast.error(zodError.errors[0].message);
          return;
        }
      }
      toast.error("Please fix the form errors");
      return;
    }

    setUpdatingProject(true);
    try {
      const response = await fetch(`/api/projects/${editingProject.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: projectData.name,
          description: projectData.description,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success("Project updated successfully");
        setShowEditProjectDialog(false);
        setEditingProject(null);
        setNewProject({ name: "", description: "", isDefault: false });
        invalidateProjects();
      } else {
        toast.error(data.error || "Failed to update project");
      }
    } catch (error) {
      console.error("Error updating project:", error);
      toast.error("Failed to update project");
    } finally {
      setUpdatingProject(false);
    }
  };

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <SuperCheckLoading size="md" message="Loading organization..." />
      </div>
    );
  }

  if (!stats || !orgDetails) {
    return (
      <div className="flex-1 space-y-4 p-4 pt-6">
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">
            Failed to load organization dashboard
          </p>
        </div>
      </div>
    );
  }

  const pendingInvitationsCount = invitations.filter(
    (invitation) => invitation.status === "pending"
  ).length;
  const expiredInvitationsCount = invitations.filter(
    (invitation) => invitation.status === "expired"
  ).length;
  const currentUserDisplayRole = roleToDisplayName(normalizeRole(currentUserRole));
  const organizationAgeDays = Math.max(
    0,
    Math.floor((Date.now() - new Date(orgDetails.createdAt).getTime()) / (1000 * 60 * 60 * 24))
  );
  const organizationAgeLabel = organizationAgeDays === 1 ? "1 day" : `${organizationAgeDays} days`;

  const roleCounts = members.reduce(
    (acc, member) => {
      const memberRole = member.role as keyof typeof acc;
      if (memberRole in acc) {
        acc[memberRole] += 1;
      }
      return acc;
    },
    {
      org_owner: 0,
      org_admin: 0,
      project_admin: 0,
      project_editor: 0,
      project_viewer: 0,
    }
  );

  const orgLevelAccessCount = roleCounts.org_owner + roleCounts.org_admin;
  const defaultProjectName = projects.find((project) => project.isDefault)?.name ?? "Not configured";

  const nextPendingInvite = invitations
    .filter((invitation) => invitation.status === "pending")
    .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime())[0];

  const nextPendingInviteExpiry = nextPendingInvite
    ? new Date(nextPendingInvite.expiresAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "No pending invites";

  return (
    <div className="overflow-hidden">
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent className="p-6 overflow-hidden">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Organization Admin</h1>
              <p className="text-muted-foreground text-sm">
                Manage your organization&apos;s projects, members, and security audit data.
              </p>
            </div>
            <TableBadge tone="info" className="max-w-[320px]">
              <Building2 className="mr-1.5 h-3.5 w-3.5" />
              <span className="truncate">{orgDetails.name}</span>
            </TableBadge>
          </div>

          <Tabs
            value={activeTab}
            className="space-y-4"
            onValueChange={handleTabChange}
          >
            <TabsList
              className={cn(
                "grid w-full lg:w-auto lg:inline-flex",
                isCloudHosted ? "grid-cols-6" : "grid-cols-5"
              )}
            >
              <TabsTrigger value="overview" className="flex items-center gap-2">
                <LayoutDashboard className="h-4 w-4" />
                <span className="hidden sm:inline">Overview</span>
              </TabsTrigger>
              <TabsTrigger value="projects" className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4" />
                <span className="hidden sm:inline">Projects</span>
              </TabsTrigger>
              <TabsTrigger value="members" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <span className="hidden sm:inline">Members</span>
              </TabsTrigger>
              <TabsTrigger value="cli-tokens" className="flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                <span className="hidden sm:inline">CLI Tokens</span>
              </TabsTrigger>
              <TabsTrigger value="audit" className="flex items-center gap-2">
                <UserSearch className="h-4 w-4" />
                <span className="hidden sm:inline">Audit</span>
              </TabsTrigger>
              {isCloudHosted && (
                <TabsTrigger
                  value="subscription"
                  className="flex items-center gap-2"
                >
                  <DollarSign className="h-4 w-4" />
                  <span className="hidden sm:inline">Subscription</span>
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 auto-rows-fr">
                <StatsCard
                  title="Projects"
                  value={stats.projects}
                  description="Active projects"
                  icon={FolderOpen}
                  variant="primary"
                  className="h-full"
                  metaInline
                />
                <StatsCard
                  title="Members"
                  value={stats.members}
                  description="Organization members"
                  icon={Users}
                  variant="purple"
                  className="h-full"
                  metaInline
                />
                <StatsCard
                  title="Scheduled Jobs"
                  value={stats.jobs}
                  description="Active jobs"
                  icon={CalendarClock}
                  variant="warning"
                  className="h-full"
                  metaInline
                />
                <StatsCard
                  title="Pending Invites"
                  value={pendingInvitationsCount}
                  description={
                    expiredInvitationsCount > 0
                      ? `${expiredInvitationsCount} expired invites`
                      : "Awaiting member response"
                  }
                  icon={Mail}
                  variant="warning"
                  className="h-full"
                  metaInline
                />
                <StatsCard
                  title="Test Cases"
                  value={stats.tests}
                  description="Available tests"
                  icon={Code}
                  variant="cyan"
                  className="h-full"
                  metaInline
                />
                <StatsCard
                  title="Monitors"
                  value={stats.monitors}
                  description="Active monitors"
                  icon={Globe}
                  variant="success"
                  className="h-full"
                  metaInline
                />
                <StatsCard
                  title="Total Runs"
                  value={stats.runs}
                  description="Test executions"
                  icon={ClipboardList}
                  className="h-full"
                  metaInline
                />
                <StatsCard
                  title="Expired Invites"
                  value={expiredInvitationsCount}
                  description={
                    pendingInvitationsCount > 0
                      ? `${pendingInvitationsCount} pending invites`
                      : "No pending invites"
                  }
                  icon={AlertTriangle}
                  variant="danger"
                  className="h-full"
                  metaInline
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="h-full">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Access Composition</CardTitle>
                    <CardDescription>Role distribution across your organization</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Org-Level Access</span>
                      <TableBadge tone="purple">{orgLevelAccessCount.toLocaleString()}</TableBadge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Project Admins</span>
                      <TableBadge tone="info">{roleCounts.project_admin.toLocaleString()}</TableBadge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Project Editors</span>
                      <TableBadge tone="success">{roleCounts.project_editor.toLocaleString()}</TableBadge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Project Viewers</span>
                      <TableBadge tone="slate">{roleCounts.project_viewer.toLocaleString()}</TableBadge>
                    </div>
                  </CardContent>
                </Card>

                <Card className="h-full">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Organization Context</CardTitle>
                    <CardDescription>Governance and lifecycle details</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Your Role</span>
                      <TableBadge tone="purple">{currentUserDisplayRole}</TableBadge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Organization Age</span>
                      <TableBadge tone="indigo">{organizationAgeLabel}</TableBadge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Default Project</span>
                      <span className="max-w-[180px] truncate text-right text-foreground" title={defaultProjectName}>
                        {defaultProjectName}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Next Invite Expiry</span>
                      <span className="text-foreground">{nextPendingInviteExpiry}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="projects" className="space-y-4">
              {projectsLoading && projects.length === 0 ? (
                <TabLoadingSpinner message="Loading projects..." />
              ) : (
                <ProjectsTable
                  projects={projects}
                  onCreateProject={() => setShowCreateProjectDialog(true)}
                  onEditProject={handleEditProject}
                  canCreateProjects={canCreateProjects(
                    normalizeRole(currentUserRole)
                  )}
                  canManageProject={canManageProject(
                    normalizeRole(currentUserRole)
                  )}
                />
              )}

              {/* Create Project Dialog */}
              <Dialog
                open={showCreateProjectDialog}
                onOpenChange={setShowCreateProjectDialog}
              >
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <FolderOpen className="h-5 w-5" />
                      Create New Project
                    </DialogTitle>
                    <DialogDescription>
                      Create a new project in your organization. Both name and
                      description are required.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <FormInput
                      id="project-name"
                      label="Name"
                      value={newProject.name}
                      onChange={(e) =>
                        setNewProject({ ...newProject, name: e.target.value })
                      }
                      placeholder="Enter project name"
                      maxLength={20}
                      showCharacterCount={true}
                    />
                    <FormInput
                      id="project-description"
                      label="Description"
                      value={newProject.description}
                      onChange={(e) =>
                        setNewProject({
                          ...newProject,
                          description: e.target.value,
                        })
                      }
                      placeholder="Enter project description"
                      maxLength={100}
                      showCharacterCount={true}
                    />
                  </div>
                  <DialogFooter className="gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setShowCreateProjectDialog(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => handleCreateProject()}
                      disabled={
                        creatingProject ||
                        !newProject.name.trim() ||
                        !newProject.description.trim()
                      }
                    >
                      {creatingProject ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        "Create Project"
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Edit Project Dialog */}
              <Dialog
                open={showEditProjectDialog}
                onOpenChange={setShowEditProjectDialog}
              >
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <FolderOpen className="h-5 w-5" />
                      Edit Project
                    </DialogTitle>
                    <DialogDescription>
                      Update your project details. Both name and description are
                      required.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <FormInput
                      id="edit-project-name"
                      label="Name"
                      value={newProject.name}
                      onChange={(e) =>
                        setNewProject({ ...newProject, name: e.target.value })
                      }
                      placeholder="Enter project name"
                      maxLength={20}
                      showCharacterCount={true}
                    />
                    <FormInput
                      id="edit-project-description"
                      label="Description"
                      value={newProject.description}
                      onChange={(e) =>
                        setNewProject({
                          ...newProject,
                          description: e.target.value,
                        })
                      }
                      placeholder="Enter project description"
                      maxLength={100}
                      showCharacterCount={true}
                    />
                  </div>
                  <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                      variant="outline"
                      onClick={() => setShowEditProjectDialog(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleUpdateProject}
                      disabled={
                        updatingProject ||
                        !newProject.name.trim() ||
                        !newProject.description.trim()
                      }
                    >
                      {updatingProject ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Updating...
                        </>
                      ) : (
                        "Update Project"
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </TabsContent>

            <TabsContent value="members" className="space-y-4">
              {membersLoading ? (
                <TabLoadingSpinner message="Loading members..." />
              ) : (
                <MembersTable
                  members={[
                    ...(members || []).map((m) => ({
                      ...m,
                      type: "member" as const,
                      role: m.role as
                        | "org_owner"
                        | "org_admin"
                        | "project_admin"
                        | "project_editor"
                        | "project_viewer",
                    })),
                    ...(invitations || [])
                      .filter(
                        (i) => i.status === "pending" || i.status === "expired"
                      )
                      .map((i) => ({
                        ...i,
                        type: "invitation" as const,
                        status: i.status as "pending" | "expired",
                      })),
                  ]}
                  onMemberUpdate={() => {
                    invalidateMembers();
                    invalidateStats();
                  }}
                  onInviteMember={() => setShowInviteDialog(true)}
                  canInviteMembers={canInviteMembers(
                    normalizeRole(currentUserRole)
                  )}
                  projects={projects.filter((p) => p.status === "active")}
                />
              )}

              {/* Member Access Dialog - Invite Mode */}
              <MemberAccessDialog
                open={showInviteDialog}
                onOpenChange={setShowInviteDialog}
                mode="invite"
                projects={projects.filter((p) => p.status === "active")}
                onSubmit={async (memberData) => {
                  setInviting(true);
                  try {
                    const response = await fetch(
                      "/api/organizations/members/invite",
                      {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          email: memberData.email,
                          role: memberData.role,
                          selectedProjects: memberData.selectedProjects,
                        }),
                      }
                    );

                    const data = await response.json();

                    if (data.success) {
                      invalidateMembers();
                    } else {
                      throw new Error(
                        data.error || "Failed to send invitation"
                      );
                    }
                  } finally {
                    setInviting(false);
                  }
                }}
                isLoading={inviting}
                isCloudMode={isCloudHosted}
              />
            </TabsContent>

            <TabsContent value="cli-tokens" className="space-y-4">
              <CliTokensTable />
            </TabsContent>

            <TabsContent value="audit" className="space-y-4">
              <AuditLogsTable />
            </TabsContent>

            {isCloudHosted && (
              <TabsContent value="subscription" className="space-y-4">
                <SubscriptionTab currentUserRole={currentUserRole} />
              </TabsContent>
            )}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
