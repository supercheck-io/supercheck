"use client";

import {
  useState,
  useEffect,
  Suspense,
  useMemo,
  useSyncExternalStore,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { TableBadge } from "@/components/ui/table-badge";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { SectionTabs, type SectionTab } from "@/components/shared/section-tabs";
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
  DollarSign,
  UserSearch,
  Terminal,
  Pencil,
  RadioTower,
  Cable,
} from "lucide-react";
import { toast } from "sonner";
import { AuditLogsTable } from "@/components/admin/audit-logs-table";
import { CliTokensTable } from "@/components/admin/cli-tokens-table";
import { MembersTable } from "@/components/org-admin/members-table";
import { ProjectsTable } from "@/components/org-admin/projects-table";
import type { Project } from "@/components/org-admin/project-columns";
import { ProjectLocationsDialog } from "@/components/org-admin/project-locations-dialog";
import { SubscriptionTab } from "@/components/org-admin/subscription-tab";
import { TrialLoadTesting } from "@/components/org-admin/trial-load-testing";
import { MemberAccessDialog } from "@/components/members/MemberAccessDialog";
import { PrivateAgentsAdminView } from "@/components/sre/private-agents/private-agents-admin-view";
import { ConnectorAdminView } from "@/components/sre/connectors/connector-admin-view";
import { DiagnosticQueriesAdminView } from "@/components/sre/connectors/diagnostic-queries-admin-view";
import { FormInput } from "@/components/ui/form-input";
import {
  createProjectSchema,
  type CreateProjectFormData,
} from "@/lib/validations/project";
import { useBreadcrumbs } from "@/components/breadcrumb-context";
import { TabLoadingSpinner } from "@/components/ui/table-skeleton";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import { Loader2 } from "lucide-react";
import type { PrivateAgentListItem } from "@/actions/private-agents";
import type { SreOnboardingStatus } from "@/actions/sre-onboarding";
import type {
  SreConnectorListItem,
  SreConnectorSetupOptions,
} from "@/actions/sre-connectors";
import type {
  SreIntegrationBindingListItem,
  SreIntegrationBindingSetupOptions,
} from "@/actions/sre-integration-bindings";
import type {
  SreDiagnosticQueryListItem,
  SreDiagnosticQuerySetupOptions,
} from "@/actions/sre-diagnostic-queries";
import {
  canCreateProjects,
  canInviteMembers,
  canManageProject,
  canManageOrganization,
} from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import { z } from "zod";
import { useAppConfig } from "@/hooks/use-app-config";
import { useProjectContext } from "@/hooks/use-project-context";
import {
  getSreAdminQueryKey,
  getSreEvidenceGraphQueryKey,
  SRE_QUERY_KEYS,
} from "@/lib/sre/query-keys";
import { updateOrganizationNameSchema } from "@/lib/validations/organization";
// Use React Query hooks for cached data fetching
import {
  useOrgDetails,
  useOrgMembers,
  useOrgProjects,
  useOrgDataInvalidation,
} from "@/hooks/use-organization";

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

type SreSetupResponse =
  | { success: true; status: SreOnboardingStatus }
  | { success: false; error: string; status: null };
type SreIntegrationsResponse = {
  success: boolean;
  error: string | null;
  connectors: SreConnectorListItem[];
  setupOptions: SreConnectorSetupOptions;
  bindings: SreIntegrationBindingListItem[];
  bindingSetupOptions: SreIntegrationBindingSetupOptions;
};
type SreDiagnosticRecipesResponse = {
  success: boolean;
  error: string | null;
  queries: SreDiagnosticQueryListItem[];
  setupOptions: SreDiagnosticQuerySetupOptions;
};
type SrePrivateAgentsResponse =
  | { success: true; agents: PrivateAgentListItem[] }
  | { success: false; error: string; agents: [] };

const ADMIN_SETUP_FETCH_TIMEOUT_MS = 15000;
const SRE_SETUP_TABS = new Set(["integrations", "private-agents"]);

async function fetchAdminSetupJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    ADMIN_SETUP_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    const result = (await response.json()) as T & {
      success?: boolean;
      error?: string | null;
    };

    if (!response.ok || result.success === false) {
      throw new Error(result.error ?? `Failed to fetch ${url}`);
    }

    return result;
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function OrgAdminDashboard() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[400px] items-center justify-center">
          <SupercheckLoading size="md" message="Loading organization..." />
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
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();

  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const { isCloudHosted } = useAppConfig();

  const allowedTabs = useMemo(
    () =>
      isCloudHosted
        ? [
            "projects",
            "members",
            "cli-tokens",
            "audit",
            "integrations",
            "private-agents",
            "subscription",
          ]
        : [
            "projects",
            "members",
            "cli-tokens",
            "audit",
            "integrations",
            "private-agents",
          ],
    [isCloudHosted],
  );

  const tabs = useMemo<SectionTab[]>(
    () =>
      [
        { value: "projects", label: "Projects", icon: FolderOpen },
        { value: "members", label: "Members", icon: Users },
        { value: "cli-tokens", label: "CLI Tokens", icon: Terminal },
        { value: "audit", label: "Audit", icon: UserSearch },
        { value: "integrations", label: "Integrations", icon: Cable },
        { value: "private-agents", label: "Private Agents", icon: RadioTower },
        { value: "subscription", label: "Subscription", icon: DollarSign },
      ].filter((tab) => allowedTabs.includes(tab.value)),
    [allowedTabs],
  );

  const requestedTab = searchParams.get("tab");
  const normalizedRequestedTab =
    requestedTab === "sre-setup"
      ? "private-agents"
      : requestedTab === "runbooks" || requestedTab === "diagnostic-recipes"
        ? "integrations"
        : requestedTab;
  const safeTab =
    normalizedRequestedTab && allowedTabs.includes(normalizedRequestedTab)
      ? normalizedRequestedTab
      : "projects";

  const [activeTab, setActiveTab] = useState(safeTab);
  const requestedSavedQueries =
    searchParams.get("section") === "saved-queries" ||
    requestedTab === "runbooks" ||
    requestedTab === "diagnostic-recipes";
  const [savedQueriesOpen, setSavedQueriesOpen] = useState(
    requestedSavedQueries && safeTab === "integrations",
  );

  const { details: orgDetails, isLoading: detailsLoading } = useOrgDetails();
  const {
    members,
    invitations,
    currentUserRole,
    isLoading: membersLoading,
  } = useOrgMembers();
  const { projects: orgProjects, isLoading: projectsLoading } =
    useOrgProjects();
  const {
    invalidateStats,
    invalidateMembers,
    invalidateProjects,
    invalidateDetails,
  } = useOrgDataInvalidation();
  const cachedSetup = queryClient.getQueryData<SreSetupResponse>(
    getSreAdminQueryKey(projectId, "setup"),
  );
  const cachedIntegrations = queryClient.getQueryData<SreIntegrationsResponse>(
    getSreAdminQueryKey(projectId, "integrations"),
  );
  const cachedDiagnostic =
    queryClient.getQueryData<SreDiagnosticRecipesResponse>(
      getSreAdminQueryKey(projectId, "diagnostic-recipes"),
    );
  const cachedPrivateAgents =
    queryClient.getQueryData<SrePrivateAgentsResponse>(
      getSreAdminQueryKey(projectId, "private-agents"),
    );

  const [connectors, setConnectors] = useState<SreConnectorListItem[]>(
    cachedIntegrations?.connectors ?? [],
  );
  const [connectorSetupOptions, setConnectorSetupOptions] =
    useState<SreConnectorSetupOptions>(
      cachedIntegrations?.setupOptions ?? { services: [], privateAgents: [] },
    );
  const [integrationBindings, setIntegrationBindings] = useState<
    SreIntegrationBindingListItem[]
  >(cachedIntegrations?.bindings ?? []);
  const [integrationBindingSetupOptions, setIntegrationBindingSetupOptions] =
    useState<SreIntegrationBindingSetupOptions>(
      cachedIntegrations?.bindingSetupOptions ?? {
        notificationProviders: [],
        connectors: [],
        services: [],
      },
    );
  const [integrationsLoadError, setIntegrationsLoadError] = useState<
    string | null
  >(null);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(
    Boolean(cachedIntegrations),
  );
  const [diagnosticQueries, setDiagnosticQueries] = useState<
    SreDiagnosticQueryListItem[]
  >(cachedDiagnostic?.queries ?? []);
  const [diagnosticSetupOptions, setDiagnosticSetupOptions] =
    useState<SreDiagnosticQuerySetupOptions>(
      cachedDiagnostic?.setupOptions ?? { connectors: [] },
    );
  const [diagnosticLoadError, setDiagnosticLoadError] = useState<string | null>(
    null,
  );
  const [diagnosticLoaded, setDiagnosticLoaded] = useState(
    Boolean(cachedDiagnostic),
  );
  const [privateAgents, setPrivateAgents] = useState<PrivateAgentListItem[]>(
    cachedPrivateAgents?.agents ?? [],
  );
  const [privateAgentsLoadError, setPrivateAgentsLoadError] = useState<
    string | null
  >(null);
  const [privateAgentsLoading, setPrivateAgentsLoading] = useState(false);
  const [privateAgentsLoaded, setPrivateAgentsLoaded] = useState(
    Boolean(cachedPrivateAgents),
  );
  const [sreSetupStatus, setSreSetupStatus] =
    useState<SreOnboardingStatus | null>(cachedSetup?.status ?? null);
  const [sreSetupLoaded, setSreSetupLoaded] = useState(Boolean(cachedSetup));

  const hasData = orgDetails !== null;
  const isInitialLoading = !isMounted || (!hasData && detailsLoading);

  const projects: Project[] = orgProjects.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    isDefault: p.isDefault,
    createdAt: p.createdAt,
    membersCount: p.membersCount ?? 0,
  }));

  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [showCreateProjectDialog, setShowCreateProjectDialog] = useState(false);
  const [showEditProjectDialog, setShowEditProjectDialog] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [updatingProject, setUpdatingProject] = useState(false);
  const [newProject, setNewProject] = useState({
    name: "",
    description: "",
    isDefault: false,
  });
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showRenameOrgDialog, setShowRenameOrgDialog] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [renamingOrg, setRenamingOrg] = useState(false);

  useEffect(() => {
    if (!SRE_SETUP_TABS.has(activeTab) || sreSetupLoaded) return;

    let isCancelled = false;
    queryClient
      .fetchQuery({
        queryKey: getSreAdminQueryKey(projectId, "setup"),
        queryFn: () =>
          fetchAdminSetupJson<SreSetupResponse>("/api/sre/onboarding"),
        staleTime: 60_000,
        meta: { persist: false },
      })
      .then((result) => {
        if (!isCancelled) setSreSetupStatus(result.status);
      })
      .catch((error) => {
        if (!isCancelled)
          console.error("Error loading AI SRE setup status:", error);
      })
      .finally(() => {
        if (!isCancelled) setSreSetupLoaded(true);
      });

    return () => {
      isCancelled = true;
    };
  }, [activeTab, projectId, queryClient, sreSetupLoaded]);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Home", href: "/", isCurrentPage: false },
      { label: "Organization", href: "/org-admin", isCurrentPage: true },
    ]);
    return () => setBreadcrumbs([]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    setActiveTab(safeTab);
  }, [safeTab]);

  useEffect(() => {
    setSavedQueriesOpen(requestedSavedQueries && safeTab === "integrations");
  }, [requestedSavedQueries, safeTab]);

  useEffect(() => {
    if (requestedTab === "services") {
      router.replace("/services");
      return;
    }
    if (
      requestedTab &&
      normalizedRequestedTab !== requestedTab &&
      allowedTabs.includes(safeTab)
    ) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", safeTab);
      if (requestedSavedQueries) params.set("section", "saved-queries");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [
    allowedTabs,
    normalizedRequestedTab,
    pathname,
    requestedTab,
    requestedSavedQueries,
    router,
    safeTab,
    searchParams,
  ]);

  useEffect(() => {
    if (activeTab !== "integrations" || integrationsLoaded) {
      return;
    }

    let isCancelled = false;
    setIntegrationsLoading(true);

    queryClient
      .fetchQuery({
        queryKey: getSreAdminQueryKey(projectId, "integrations"),
        queryFn: () =>
          fetchAdminSetupJson<SreIntegrationsResponse>("/api/sre/integrations"),
        staleTime: 60_000,
        meta: { persist: false },
      })
      .then((result) => {
        if (isCancelled) return;
        setConnectors(result.connectors);
        setConnectorSetupOptions(result.setupOptions);
        setIntegrationBindings(result.bindings);
        setIntegrationBindingSetupOptions(result.bindingSetupOptions);
        setIntegrationsLoadError(null);
        setIntegrationsLoaded(true);
      })
      .catch((error) => {
        if (isCancelled) return;
        console.error("Error loading integrations:", error);
        setConnectors([]);
        setIntegrationBindings([]);
        setIntegrationsLoadError("Failed to fetch evidence integrations");
        setIntegrationsLoaded(true);
      })
      .finally(() => {
        if (!isCancelled) setIntegrationsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [activeTab, integrationsLoaded, projectId, queryClient]);

  useEffect(() => {
    if (activeTab !== "integrations" || !savedQueriesOpen || diagnosticLoaded) {
      return;
    }

    let isCancelled = false;

    queryClient
      .fetchQuery({
        queryKey: getSreAdminQueryKey(projectId, "diagnostic-recipes"),
        queryFn: () =>
          fetchAdminSetupJson<SreDiagnosticRecipesResponse>(
            "/api/sre/diagnostic-recipes",
          ),
        staleTime: 60_000,
        meta: { persist: false },
      })
      .then((result) => {
        if (isCancelled) return;
        setDiagnosticQueries(result.queries);
        setDiagnosticSetupOptions(result.setupOptions);
        setDiagnosticLoadError(null);
        setDiagnosticLoaded(true);
      })
      .catch((error) => {
        if (isCancelled) return;
        console.error("Error loading saved queries:", error);
        setDiagnosticQueries([]);
        setDiagnosticLoadError("Failed to fetch saved queries");
        setDiagnosticLoaded(true);
      });

    return () => {
      isCancelled = true;
    };
  }, [activeTab, savedQueriesOpen, diagnosticLoaded, projectId, queryClient]);

  useEffect(() => {
    if (activeTab !== "private-agents" || privateAgentsLoaded) {
      return;
    }

    let isCancelled = false;
    setPrivateAgentsLoading(true);

    queryClient
      .fetchQuery({
        queryKey: getSreAdminQueryKey(projectId, "private-agents"),
        queryFn: () =>
          fetchAdminSetupJson<SrePrivateAgentsResponse>(
            "/api/sre/private-agents",
          ),
        staleTime: 60_000,
        meta: { persist: false },
      })
      .then((result) => {
        if (isCancelled) return;
        setPrivateAgents(result.agents);
        setPrivateAgentsLoadError(result.success ? null : result.error);
        setPrivateAgentsLoaded(true);
      })
      .catch((error) => {
        if (isCancelled) return;
        console.error("Error loading Private Agents:", error);
        setPrivateAgents([]);
        setPrivateAgentsLoadError("Failed to fetch Private Agents");
        setPrivateAgentsLoaded(true);
      })
      .finally(() => {
        if (!isCancelled) setPrivateAgentsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [activeTab, privateAgentsLoaded, projectId, queryClient]);

  const handleTabChange = (value: string) => {
    if (!allowedTabs.includes(value)) {
      return;
    }

    setActiveTab(value);

    const params = new URLSearchParams(searchParams.toString());
    if (value === "projects") {
      params.delete("tab");
    } else {
      params.set("tab", value);
    }
    params.delete("action");
    params.delete("section");
    setSavedQueriesOpen(false);

    const nextUrl = params.toString()
      ? `${pathname}?${params.toString()}`
      : pathname;
    router.replace(nextUrl, { scroll: false });
  };

  const handleSavedQueriesOpenChange = (open: boolean) => {
    setSavedQueriesOpen(open);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "integrations");
    if (open) params.set("section", "saved-queries");
    else params.delete("section");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleSreSetupChanged = () => {
    void queryClient.invalidateQueries({ queryKey: SRE_QUERY_KEYS.admin });
    void queryClient.invalidateQueries({
      queryKey: getSreEvidenceGraphQueryKey(projectId),
    });
    setSreSetupLoaded(false);
    setDiagnosticLoaded(false);
  };

  const handleRenameOrganization = async () => {
    if (!orgDetails) return;

    const trimmedName = newOrgName.trim();

    try {
      updateOrganizationNameSchema.parse({ name: trimmedName });
    } catch (error) {
      if (error instanceof z.ZodError && error.issues.length > 0) {
        toast.error(error.issues[0].message);
        return;
      }
      toast.error("Please enter a valid organization name");
      return;
    }

    setRenamingOrg(true);
    try {
      const response = await fetch(`/api/organizations/${orgDetails.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success("Organization renamed successfully");
        setShowRenameOrgDialog(false);
        setNewOrgName("");
        invalidateDetails();
        invalidateStats();
      } else {
        toast.error(data.error || "Failed to rename organization");
      }
    } catch (error) {
      console.error("Error renaming organization:", error);
      toast.error("Failed to rename organization");
    } finally {
      setRenamingOrg(false);
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
        if (zodError.issues && zodError.issues.length > 0) {
          toast.error(zodError.issues[0].message);
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

  const [locationProject, setLocationProject] = useState<Project | null>(null);

  const handleManageLocations = (project: Project) => {
    setLocationProject(project);
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
        if (zodError.issues && zodError.issues.length > 0) {
          toast.error(zodError.issues[0].message);
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
        <SupercheckLoading size="md" message="Loading organization..." />
      </div>
    );
  }

  if (!orgDetails) {
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

  const userCanRenameOrg = canManageOrganization(
    normalizeRole(currentUserRole),
  );

  return (
    <div>
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent className="p-6 overflow-hidden">
      <Tabs
        value={activeTab}
        className="w-full space-y-4"
        onValueChange={handleTabChange}
      >
        <PageHeader
          title="Organization"
          titleAdornment={
            <span className="inline-flex min-w-0 max-w-[320px] items-center gap-1">
              <TableBadge tone="info" className="min-w-0">
                <Building2 className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{orgDetails.name}</span>
              </TableBadge>
              {userCanRenameOrg && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => {
                    setNewOrgName(orgDetails.name);
                    setShowRenameOrgDialog(true);
                  }}
                  title="Rename organization"
                  aria-label="Rename organization"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </span>
          }
          actions={
            <SectionTabs
              tabs={tabs}
              value={activeTab}
              onValueChange={handleTabChange}
              collapseBelow="xl"
            />
          }
        />

        <TabsContent value="projects" className="mt-0 space-y-4">
          {projectsLoading && projects.length === 0 ? (
            <TabLoadingSpinner message="Loading projects..." />
          ) : (
            <ProjectsTable
              projects={projects}
              onCreateProject={() => setShowCreateProjectDialog(true)}
              onEditProject={handleEditProject}
              onManageLocations={handleManageLocations}
              canCreateProjects={canCreateProjects(
                normalizeRole(currentUserRole),
              )}
              canManageProject={canManageProject(
                normalizeRole(currentUserRole),
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

          {/* Project Location Restrictions Dialog */}
          {locationProject && (
            <ProjectLocationsDialog
              open={!!locationProject}
              onOpenChange={(open) => {
                if (!open) setLocationProject(null);
              }}
              projectId={locationProject.id}
              projectName={locationProject.name}
            />
          )}
        </TabsContent>

        <TabsContent value="members" className="mt-0 space-y-4">
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
                    (i) => i.status === "pending" || i.status === "expired",
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
                // Role and project-access changes move the per-project member counts.
                invalidateProjects();
              }}
              onInviteMember={() => setShowInviteDialog(true)}
              canInviteMembers={canInviteMembers(
                normalizeRole(currentUserRole),
              )}
              projects={projects}
            />
          )}

          {/* Member Access Dialog - Invite Mode */}
          <MemberAccessDialog
            open={showInviteDialog}
            onOpenChange={setShowInviteDialog}
            mode="invite"
            projects={projects}
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
                  },
                );

                const data = await response.json();

                if (data.success) {
                  invalidateMembers();
                } else {
                  throw new Error(data.error || "Failed to send invitation");
                }
              } finally {
                setInviting(false);
              }
            }}
            isLoading={inviting}
            isCloudMode={isCloudHosted}
          />
        </TabsContent>

        <TabsContent value="cli-tokens" className="mt-0 space-y-4">
          <CliTokensTable />
        </TabsContent>

        <TabsContent value="integrations" className="mt-0 space-y-4">
          {integrationsLoading && !integrationsLoaded ? (
            <TabLoadingSpinner message="Loading integrations..." />
          ) : (
            <ConnectorAdminView
              initialConnectors={connectors}
              setupOptions={connectorSetupOptions}
              initialBindings={integrationBindings}
              bindingSetupOptions={integrationBindingSetupOptions}
              loadError={integrationsLoadError}
              setupStatus={sreSetupStatus}
              onSetupChanged={handleSreSetupChanged}
              onOpenSavedQueries={() => handleSavedQueriesOpenChange(true)}
            />
          )}
        </TabsContent>

        <TabsContent value="private-agents" className="mt-0 space-y-4">
          {privateAgentsLoading && !privateAgentsLoaded ? (
            <TabLoadingSpinner message="Loading Private Agents..." />
          ) : (
            <PrivateAgentsAdminView
              initialAgents={privateAgents}
              loadError={privateAgentsLoadError}
              onSetupChanged={handleSreSetupChanged}
            />
          )}
        </TabsContent>

        <TabsContent value="audit" className="mt-0 space-y-4">
          <AuditLogsTable />
        </TabsContent>

        {isCloudHosted && (
          <TabsContent value="subscription" className="mt-0 space-y-4">
            <SubscriptionTab
              key={orgDetails?.id}
              currentUserRole={currentUserRole}
            />
            <TrialLoadTesting canManage={userCanRenameOrg} />
          </TabsContent>
        )}
      </Tabs>
        </CardContent>
      </Card>

      <Dialog
        open={savedQueriesOpen}
        onOpenChange={handleSavedQueriesOpenChange}
      >
        <DialogContent className="max-h-[calc(100svh-2rem)] w-[calc(100vw-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-5xl">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle>Saved queries</DialogTitle>
            <DialogDescription>
              Reuse read-only queries for common investigation questions.
              Investigations work without them.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-5">
            {!diagnosticLoaded ? (
              <TabLoadingSpinner message="Loading saved queries..." />
            ) : (
              <DiagnosticQueriesAdminView
                initialQueries={diagnosticQueries}
                setupOptions={diagnosticSetupOptions}
                loadError={diagnosticLoadError}
                setupStatus={sreSetupStatus}
                onSetupChanged={handleSreSetupChanged}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename Organization Dialog */}
      <Dialog open={showRenameOrgDialog} onOpenChange={setShowRenameOrgDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Rename Organization
            </DialogTitle>
            <DialogDescription>
              Update your organization&apos;s display name. This change is
              visible to all members.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <FormInput
              id="org-name"
              label="Organization Name"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder="Enter organization name"
              maxLength={50}
              showCharacterCount={true}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowRenameOrgDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRenameOrganization}
              disabled={
                renamingOrg ||
                !newOrgName.trim() ||
                newOrgName.trim() === orgDetails?.name
              }
            >
              {renamingOrg ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Renaming...
                </>
              ) : (
                "Rename"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
