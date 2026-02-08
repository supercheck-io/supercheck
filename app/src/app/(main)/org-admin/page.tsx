"use client";

import { useState, useEffect, Suspense, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { StatsCard } from "@/components/admin/stats-card";
import { Card, CardContent } from "@/components/ui/card";
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
  LayoutDashboard,
  DollarSign,
  UserSearch,
  CalendarClock,
  Code,
  Globe,
  ClipboardList,
  Terminal,
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
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import { z } from "zod";
import { useAppConfig } from "@/hooks/use-app-config";
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
  const searchParams = useSearchParams();
  const defaultTab = searchParams.get("tab") || "overview";
  const [activeTab, setActiveTab] = useState(defaultTab);

  const isMounted = useSyncExternalStore(
    () => () => { },
    () => true,
    () => false
  );

  const { isCloudHosted } = useAppConfig();

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

  const handleTabChange = (_value: string) => { };

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

  return (
    <div>
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent className="p-6">
          <Tabs
            value={activeTab}
            className="space-y-4"
            onValueChange={(value) => {
              setActiveTab(value);
              handleTabChange(value);
            }}
          >
            <TabsList
              className="grid w-full grid-cols-4 lg:w-auto lg:inline-flex"
              style={{
                gridTemplateColumns: isCloudHosted
                  ? "repeat(6, 1fr)"
                  : "repeat(5, 1fr)",
              }}
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
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">
                    Organization Admin
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    Manage your organization&apos;s projects, members, and view
                    audit logs.
                  </p>
                </div>
              </div>

              {/* Primary Metrics - 3 columns on large, 2 on medium */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <StatsCard
                  title="Projects"
                  value={stats.projects}
                  description="Active projects"
                  icon={FolderOpen}
                  variant="primary"
                />
                <StatsCard
                  title="Members"
                  value={stats.members}
                  description="Organization members"
                  icon={Users}
                  variant="purple"
                />
                <StatsCard
                  title="Scheduled Jobs"
                  value={stats.jobs}
                  description="Active jobs"
                  icon={CalendarClock}
                  variant="warning"
                />
              </div>

              {/* Secondary Metrics */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <StatsCard
                  title="Test Cases"
                  value={stats.tests}
                  description="Available tests"
                  icon={Code}
                  variant="cyan"
                />
                <StatsCard
                  title="Monitors"
                  value={stats.monitors}
                  description="Active monitors"
                  icon={Globe}
                  variant="success"
                />
                <StatsCard
                  title="Total Runs"
                  value={stats.runs}
                  description="Test executions"
                  icon={ClipboardList}
                />
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
