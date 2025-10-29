"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FolderOpen, Activity, TrendingUp, Calendar, Users } from "lucide-react";
import { toast } from "sonner";
import { AuditLogsTable } from "@/components/admin/audit-logs-table";
import { MembersTable } from "@/components/org-admin/members-table";
import { ProjectsTable } from "@/components/org-admin/projects-table";
import { MemberAccessDialog } from "@/components/members/MemberAccessDialog";
import { FormInput } from "@/components/ui/form-input";
import { createProjectSchema, type CreateProjectFormData } from "@/lib/validations/project";
// import { useFormValidation } from "@/hooks/use-form-validation";
import { useBreadcrumbs } from "@/components/breadcrumb-context";
import { OrgAdminDashboardSkeleton } from "@/components/ui/table-skeleton";
import { Loader2 } from "lucide-react";
import { canCreateProjects, canInviteMembers, canManageProject } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import { z } from "zod";

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
  role: 'org_owner' | 'org_admin' | 'project_admin' | 'project_editor' | 'project_viewer';
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
  status: 'active' | 'archived' | 'deleted';
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
  const { setBreadcrumbs } = useBreadcrumbs();
  const [stats, setStats] = useState<OrgStats | null>(null);
  const [orgDetails, setOrgDetails] = useState<OrgDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState<string>('project_viewer');
  
  // Members tab state
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviting, setInviting] = useState(false);
  
  // Projects tab state
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreateProjectDialog, setShowCreateProjectDialog] = useState(false);
  const [showEditProjectDialog, setShowEditProjectDialog] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [updatingProject, setUpdatingProject] = useState(false);
  const [newProject, setNewProject] = useState({
    name: "",
    description: "",
    isDefault: false
  });
  const [editingProject, setEditingProject] = useState<Project | null>(null);



  useEffect(() => {
    fetchOrgData();
    // Also fetch members and invitations data on mount
    fetchMembers();
    fetchInvitations();
  }, []);

  // Set breadcrumbs
  useEffect(() => {
    setBreadcrumbs([
      { label: "Home", href: "/", isCurrentPage: false }, 
      { label: "Organization Admin", href: "/org-admin", isCurrentPage: true }
    ]);

    // Cleanup breadcrumbs on unmount
    return () => {
      setBreadcrumbs([]);
    };
  }, [setBreadcrumbs]);

  const handleTabChange = (value: string) => {
    if (value === 'projects' && projects.length === 0) {
      fetchProjects();
    }
    // Note: Audit tab handles its own data fetching
    // Members data is now fetched on mount
  };

  const fetchOrgData = async () => {
    try {
      // Fetch organization stats and details
      const [statsResponse, detailsResponse] = await Promise.all([
        fetch('/api/organizations/stats'),
        fetch('/api/organizations/current')
      ]);
      
      const [statsData, detailsData] = await Promise.all([
        statsResponse.json(),
        detailsResponse.json()
      ]);

      if (statsData.success) {
        setStats(statsData.data);
      }
      
      if (detailsData.success) {
        setOrgDetails(detailsData.data);
      }
    } catch (error) {
      console.error('Error fetching organization data:', error);
      toast.error('Failed to load organization data');
    } finally {
      setLoading(false);
    }
  };

  const fetchMembers = async () => {
    setMembersLoading(true);
    try {
      const response = await fetch('/api/organizations/members');
      const data = await response.json();
      
      if (data.success) {
        setMembers(data.data.members);
        setInvitations(data.data.invitations);
        setCurrentUserRole(data.data.currentUserRole || 'project_viewer');
      } else {
        console.error('Failed to fetch members:', data.error);
      }
    } catch (error) {
      console.error('Error fetching members:', error);
    } finally {
      setMembersLoading(false);
    }
  };

  const fetchInvitations = async () => {
    try {
      const response = await fetch('/api/organizations/invitations');
      const data = await response.json();

      if (data.success) {
        setInvitations(data.data);
      } else {
        console.error('Failed to load invitations:', data.error);
      }
    } catch (error) {
      console.error('Error fetching invitations:', error);
    }
  };

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects');
      const data = await response.json();

      if (data.success) {
        // Fetch member details for each project
        const projectsWithMembers = await Promise.all(
          data.data.map(async (project: Project) => {
            try {
              const membersResponse = await fetch(`/api/projects/${project.id}/members`);
              const membersData = await membersResponse.json();
              
              if (membersData.success) {
                return {
                  ...project,
                  membersCount: membersData.members.length,
                  members: membersData.members.map((member: ProjectMember) => ({
                    id: member.user.id,
                    name: member.user.name,
                    email: member.user.email,
                    role: member.role,
                    avatar: member.user.image
                  }))
                };
              }
              return project;
            } catch (error) {
              console.error(`Error fetching members for project ${project.id}:`, error);
              return project;
            }
          })
        );
        
        setProjects(projectsWithMembers);
      } else {
        toast.error('Failed to load projects');
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
      toast.error('Failed to load projects');
    }
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
      toast.error('Please fix the form errors');
      return;
    }

    setCreatingProject(true);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: projectData.name,
          description: projectData.description,
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        toast.success('Project created successfully');
        setShowCreateProjectDialog(false);
        setNewProject({
          name: "",
          description: "",
          isDefault: false
        });
        fetchProjects();
      } else {
        toast.error(data.error || 'Failed to create project');
      }
    } catch (error) {
      console.error('Error creating project:', error);
      toast.error('Failed to create project');
    } finally {
      setCreatingProject(false);
    }
  };

  const handleEditProject = (project: Project) => {
    setEditingProject(project);
    setNewProject({
      name: project.name,
      description: project.description || "",
      isDefault: project.isDefault
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
      toast.error('Please fix the form errors');
      return;
    }

    setUpdatingProject(true);
    try {
      const response = await fetch(`/api/projects/${editingProject.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: projectData.name,
          description: projectData.description,
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        toast.success('Project updated successfully');
        setShowEditProjectDialog(false);
        setEditingProject(null);
        setNewProject({
          name: "",
          description: "",
          isDefault: false
        });
        fetchProjects();
      } else {
        toast.error(data.error || 'Failed to update project');
      }
    } catch (error) {
      console.error('Error updating project:', error);
      toast.error('Failed to update project');
    } finally {
      setUpdatingProject(false);
    }
  };


  if (loading) {
    return <OrgAdminDashboardSkeleton />;
  }

  if (!stats || !orgDetails) {
    return (
      <div className="flex-1 space-y-4 p-4 pt-6">
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Failed to load organization dashboard</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent className="p-6">
          <Tabs defaultValue="overview" className="space-y-4" onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Organization Admin</h2>
              <p className="text-muted-foreground text-sm">Manage your organization&apos;s projects, members, and view audit logs.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Projects</CardTitle>
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.projects}</div>
                <p className="text-xs text-muted-foreground">
                  Active projects
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Members</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.members}</div>
                <p className="text-xs text-muted-foreground">
                  Organization members
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Jobs</CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.jobs}</div>
                <p className="text-xs text-muted-foreground">
                  Scheduled jobs
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Tests</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.tests}</div>
                <p className="text-xs text-muted-foreground">
                  Test cases
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Monitors</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.monitors}</div>
                <p className="text-xs text-muted-foreground">
                  Active monitors
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Runs</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.runs}</div>
                <p className="text-xs text-muted-foreground">
                  Test executions
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="projects" className="space-y-4">
              <ProjectsTable
                projects={projects}
                onCreateProject={() => setShowCreateProjectDialog(true)}
                onEditProject={handleEditProject}
                canCreateProjects={canCreateProjects(normalizeRole(currentUserRole))}
                canManageProject={canManageProject(normalizeRole(currentUserRole))}
              />
          
          {/* Create Project Dialog */}
          <Dialog open={showCreateProjectDialog} onOpenChange={setShowCreateProjectDialog}>
            <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Project</DialogTitle>
                    <DialogDescription>
                      Create a new project in your organization. Both name and description are required.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <FormInput
                      id="project-name"
                      label="Name"
                      value={newProject.name}
                      onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                      placeholder="Enter project name"
                      maxLength={20}
                      showCharacterCount={true}
                    />
                    <FormInput
                      id="project-description"
                      label="Description"
                      value={newProject.description}
                      onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                      placeholder="Enter project description"
                      maxLength={100}
                      showCharacterCount={true}
                    />
                  </div>
                  <DialogFooter>
                    <Button onClick={() => handleCreateProject()} disabled={creatingProject || !newProject.name.trim() || !newProject.description.trim()}>
                      {creatingProject ? "Creating..." : "Create Project"}
                    </Button>
                            </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Project Dialog */}
      <Dialog open={showEditProjectDialog} onOpenChange={setShowEditProjectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>
              Update your project details. Both name and description are required.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <FormInput
              id="edit-project-name"
              label="Name"
              value={newProject.name}
              onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
              placeholder="Enter project name"
              maxLength={20}
              showCharacterCount={true}
            />
            <FormInput
              id="edit-project-description"
              label="Description"
              value={newProject.description}
              onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
              placeholder="Enter project description"
              maxLength={100}
              showCharacterCount={true}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleUpdateProject} disabled={updatingProject || !newProject.name.trim() || !newProject.description.trim()}>
              {updatingProject ? "Updating..." : "Update Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </TabsContent>

        <TabsContent value="members" className="space-y-4">
          {membersLoading ? (
            <div className="flex justify-center items-center h-64">
              <div className="flex items-center space-x-2">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Loading members...</span>
              </div>
            </div>
          ) : (
                <MembersTable
                  members={[
                    ...(members || []).map(m => ({ 
                      ...m, 
                      type: 'member' as const,
                      role: m.role as 'org_owner' | 'org_admin' | 'project_admin' | 'project_editor' | 'project_viewer'
                    })),
                    ...(invitations || [])
                      .filter(i => i.status === 'pending' || i.status === 'expired')
                      .map(i => ({ ...i, type: 'invitation' as const, status: i.status as 'pending' | 'expired' }))
                  ]}
                  onMemberUpdate={() => {
                    fetchMembers();
                    fetchInvitations();
                    fetchOrgData();
                  }}
                  onInviteMember={() => {
                    setShowInviteDialog(true);
                    if (projects.length === 0) {
                      fetchProjects();
                    }
                  }}
                  canInviteMembers={canInviteMembers(normalizeRole(currentUserRole))}
                  projects={projects.filter(p => p.status === 'active')}
                />
          )}

          {/* Member Access Dialog - Invite Mode */}
          <MemberAccessDialog
            open={showInviteDialog}
            onOpenChange={(open) => {
              setShowInviteDialog(open);
              if (open && projects.length === 0) {
                fetchProjects();
              }
            }}
            mode="invite"
            projects={projects.filter(p => p.status === 'active')}
            onSubmit={async (memberData) => {
              setInviting(true);
              try {
                const response = await fetch('/api/organizations/members/invite', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    email: memberData.email,
                    role: memberData.role,
                    selectedProjects: memberData.selectedProjects
                  }),
                });

                const data = await response.json();
                
                if (data.success) {
                  fetchMembers();
                  fetchInvitations();
                } else {
                  throw new Error(data.error || 'Failed to send invitation');
                }
              } finally {
                setInviting(false);
              }
            }}
            isLoading={inviting}
          />
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          <AuditLogsTable />
        </TabsContent>
      </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}