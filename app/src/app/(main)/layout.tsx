import { AppSidebar } from "@/components/app-sidebar";
import { ShellMain } from "@/components/shell-main";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ParallelThreads } from "@/components/parallel-threads";
import { BreadcrumbProvider } from "@/components/breadcrumb-context";
import { BreadcrumbDisplay } from "@/components/breadcrumb-display";
import { JobProvider } from "@/components/jobs/job-context";
import { CommandSearch } from "@/components/ui/command-search";
import { SetupChecker } from "@/components/setup-checker";
import { ProjectContextProvider, type ProjectContext } from "@/hooks/use-project-context";
import { NavUser } from "@/components/nav-user";
import { DemoBadge } from "@/components/demo-badge";
import { CommunityLinks } from "@/components/community-links";
import { SubscriptionGuard, type SubscriptionStatus } from "@/components/subscription-guard";
import { AuthGuard } from "@/components/auth-guard";
import { DataPrefetcher } from "@/components/data-prefetcher";
import { MonacoPrefetcher } from "@/components/monaco-prefetcher";
import { RecorderAutoConnect } from "@/components/recorder/RecorderAutoConnect";
import { getCurrentUser, getActiveOrganization, getSelectableProjects } from "@/lib/session";
import { getCurrentProjectContext } from "@/lib/project-context";
import { isSelfHosted } from "@/lib/feature-flags";
import { SentryBrowser } from "@/components/sentry-browser";
import { ShellBootstrapProvider, type ShellBootstrap } from "@/components/shell-bootstrap";
import { headers } from "next/headers";
import { getSentryBrowserConfig } from "@/lib/sentry-client-config";
import { getSentryDsn } from "@/lib/sentry-gate";
import { getImpersonationStatus } from "@/lib/impersonation-status";
import { getUserPreferences } from "@/lib/setup/setup-state";
import { getSetupSummary } from "@/lib/setup/summary";
import { resolveSetupFeatures } from "@/lib/setup/features";
import { isAIProviderConfigured } from "@/lib/ai/ai-provider";
import { getTrialSummary } from "@/lib/execution/trial-limits";
import { TrialBanner } from "@/components/trial-banner";
import { SpendingCapBanner } from "@/components/spending-cap-banner";
import { PendingDeletionBanner } from "@/components/pending-deletion-banner";
import { checkPermissionWithContext, getUserOrgRole } from "@/lib/rbac/middleware";
import { Role } from "@/lib/rbac/permissions";

function deriveInitialSubscriptionStatus(
  org: NonNullable<Awaited<ReturnType<typeof getActiveOrganization>>>,
  selfHosted: boolean
): SubscriptionStatus {
  if (selfHosted) {
    return { isActive: true, plan: "unlimited" };
  }

  const plan =
    org.subscriptionPlan === "plus" || org.subscriptionPlan === "pro"
      ? org.subscriptionPlan
      : null;
  if (!plan) {
    return { isActive: false, plan: null };
  }

  if (org.subscriptionStatus === "active" || org.subscriptionStatus === "past_due") {
    return { isActive: true, plan };
  }

  if (org.subscriptionStatus === "canceled" && org.subscriptionEndsAt) {
    return {
      isActive: new Date(org.subscriptionEndsAt).getTime() > Date.now(),
      plan,
    };
  }

  return { isActive: false, plan };
}

export default async function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let user = null;
  let org = null;

  try {
    [user, org] = await Promise.all([
      getCurrentUser(),
      getActiveOrganization(),
    ]);
  } catch (error) {
    console.error('[MainLayout] Server-side session fetch failed:', error);
  }

  let initialProjects: ProjectContext[] = [];
  let initialCurrentProject: ProjectContext | null = null;
  let initialSession: { user: { id: string; name: string; email: string; image?: string | null } } | null = null;
  let initialSubscriptionStatus: SubscriptionStatus | null = null;
  let commandSearchCapabilities = {
    canInvestigateSre: false,
    canConfigureSre: false,
    canCreateProjects: false,
    canInviteMembers: false,
    canCreateCliTokens: false,
    canCreateSreServices: false,
    canConfigureSreConnectors: false,
    canDeclareIncidents: false,
    canScheduleMaintenance: false,
  };
  const initialIsSelfHosted = isSelfHosted();
  let showSpendingCap = false;
  const orgPendingDeletion = !!org?.deletionRequestedAt;
  let isOrgOwner = false;
  // Values the shell would otherwise request after hydration; each lookup fails soft, leaving that
  // hook on its own request. Read in parallel with the lookups above.
  const bootstrap: ShellBootstrap = { userId: user?.id ?? "", readAt: Date.now() };

  if (user && org) {
    // Derive subscription status from org data already fetched (avoids client-side API call)
    initialSubscriptionStatus = deriveInitialSubscriptionStatus(
      org,
      initialIsSelfHosted
    );
    // A free trial is separate from a paid subscription; without it an
    // unsubscribed organization would be sent to the subscribe page.
    // Only paying org admins can see or change the cap, so only they poll it.
    // One role lookup serves the sidebar's admin links and the spending-cap and pending-deletion banners.
    const needsSpendingCapRole = !initialIsSelfHosted && initialSubscriptionStatus.isActive;
    // The role, trial and project lookups do not depend on each other, so they run together.
    const rolePromise = getUserOrgRole(user.id, org.id).catch(() => undefined);
    const impersonationPromise = getImpersonationStatus();
    const preferencesPromise = getUserPreferences(user.id).catch(() => undefined);
    const trialPromise = !initialIsSelfHosted && !initialSubscriptionStatus.isActive
      ? getTrialSummary(org.id).catch(() => undefined)
      : Promise.resolve(undefined);
    // getCurrentProjectContext can write (default project membership), so it only runs once a
    // signed-in user with an organization is known.
    const projectsPromise = getSelectableProjects(user.id);
    const currentProjectPromise = getCurrentProjectContext();
    // The sidebar's setup badge, for the project being rendered, once that project is known.
    const userId = user.id;
    const setupSummaryPromise = resolveSetupFeatures({ aiConfigured: isAIProviderConfigured() }).setup
      ? currentProjectPromise
          .then(async (project) =>
            project &&
            checkPermissionWithContext("project", "view", {
              userId,
              organizationId: project.organizationId,
              orgPendingDeletion,
              project: { id: project.id, userRole: project.userRole },
            })
              ? { projectId: project.id, summary: await getSetupSummary(project.organizationId, project.id, userId) }
              : undefined,
          )
          .catch(() => undefined)
      : Promise.resolve(undefined);
    // Settled inside the try below; this only avoids an unhandled rejection while role/trial resolve.
    // (getCurrentProjectContext swallows its own errors, so it needs no such guard.)
    projectsPromise.catch(() => undefined);
    const [role, trial, impersonation, preferences, setupSummary] = await Promise.all([
      rolePromise,
      trialPromise,
      impersonationPromise,
      preferencesPromise,
      setupSummaryPromise,
    ]);
    isOrgOwner = role === Role.ORG_OWNER;
    // Same answers as /api/admin/check: super admin from the user's role, org admin from the active org.
    if (role !== undefined) {
      bootstrap.adminStatus = {
        isAdmin: user.role === Role.SUPER_ADMIN,
        isOrgAdmin: role === Role.ORG_ADMIN || role === Role.ORG_OWNER,
      };
    }
    // Only what the client reads: the original admin's details stay out of the page.
    bootstrap.impersonation = { isImpersonating: impersonation.isImpersonating, impersonatedUser: impersonation.impersonatedUser };
    bootstrap.preferences = preferences;
    bootstrap.setupSummary = setupSummary;
    if (needsSpendingCapRole) {
      showSpendingCap = role === Role.ORG_ADMIN || role === Role.ORG_OWNER;
    }
    if (!initialIsSelfHosted && !initialSubscriptionStatus.isActive) {
      initialSubscriptionStatus = { ...initialSubscriptionStatus, trial: trial ?? null };
    }
    try {
      const [projectsResult, currentProjectResult] = await Promise.all([
        projectsPromise,
        currentProjectPromise,
      ]);

      initialProjects = projectsResult.map(p => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        organizationId: p.organizationId,
        organizationName: p.organizationName,
        isDefault: p.isDefault,
        userRole: p.role || 'project_viewer',
      }));

      initialCurrentProject = currentProjectResult;
      if (currentProjectResult) {
        const permissionContext = {
          userId: user.id,
          organizationId: currentProjectResult.organizationId,
          orgPendingDeletion: !!org?.deletionRequestedAt,
          project: {
            id: currentProjectResult.id,
            userRole: currentProjectResult.userRole,
          },
        };
        commandSearchCapabilities = {
          canInvestigateSre: checkPermissionWithContext(
            "sre_investigation",
            "investigate",
            permissionContext
          ),
          canConfigureSre: checkPermissionWithContext(
            "sre_connector",
            "configure",
            permissionContext
          ),
          canCreateProjects: checkPermissionWithContext("project", "create", permissionContext),
          canInviteMembers: checkPermissionWithContext("member", "create", permissionContext),
          canCreateCliTokens: checkPermissionWithContext("apiKey", "create", permissionContext),
          canCreateSreServices: checkPermissionWithContext("sre_service", "create", permissionContext),
          canConfigureSreConnectors: checkPermissionWithContext("sre_connector", "configure", permissionContext),
          canDeclareIncidents: checkPermissionWithContext("sre_incident", "create", permissionContext),
          canScheduleMaintenance: checkPermissionWithContext("monitor", "update", permissionContext),
        };
      }

      initialSession = {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        }
      };
    } catch (error) {
      console.error('[MainLayout] Server-side project fetch failed:', error);
      initialProjects = [];
      initialCurrentProject = null;
      initialSession = {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        }
      };
    }
  }

  // Supercheck Cloud only: nothing is read or rendered when self-hosted, without a DSN, or on a status-page host.
  const sentryConfig = getSentryDsn() ? getSentryBrowserConfig(await headers()) : {};

  return (
    <AuthGuard initialSession={initialSession}>
      <ShellBootstrapProvider value={bootstrap}>
        <MonacoPrefetcher />
        {sentryConfig.dsn ? <SentryBrowser config={sentryConfig} /> : null}
        <RecorderAutoConnect />
        <BreadcrumbProvider>
          <ProjectContextProvider
            initialProjects={initialProjects}
            initialCurrentProject={initialCurrentProject}
          >
            <DataPrefetcher />
            <SidebarProvider>
              <JobProvider>
                <SetupChecker />
                <AppSidebar />
                <SidebarInset className="lg:h-svh lg:min-h-0">
                  <header className="sticky top-0 z-10 flex h-14 min-w-0 shrink-0 items-center justify-between gap-2 border-b border-t bg-background transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
                    <div className="flex min-w-0 flex-1 items-center gap-2 px-2 sm:px-4">
                      <SidebarTrigger className="-ml-1 shrink-0" />
                      <Separator
                        orientation="vertical"
                        className="mr-2 hidden shrink-0 sm:block data-[orientation=vertical]:h-4"
                      />
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <BreadcrumbDisplay />
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 px-2 sm:gap-4 sm:px-4">
                      <div className="hidden xl:block">
                        <DemoBadge />
                      </div>
                      <CommandSearch {...commandSearchCapabilities} />
                      <div className="hidden xl:block">
                        <ParallelThreads />
                      </div>
                      <div className="hidden lg:block">
                        <CommunityLinks />
                      </div>
                      <NavUser />
                    </div>
                  </header>
                  <ShellMain className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    {org && <PendingDeletionBanner organizationId={org.id} pending={orgPendingDeletion} isOwner={isOrgOwner} />}
                    <TrialBanner initialTrial={initialSubscriptionStatus?.trial ?? null} />
                    <SpendingCapBanner enabled={showSpendingCap} />
                    <SubscriptionGuard
                      initialSubscriptionStatus={initialSubscriptionStatus}
                      initialIsSelfHosted={initialIsSelfHosted}
                    >
                      {children}
                    </SubscriptionGuard>
                  </ShellMain>
                </SidebarInset>
              </JobProvider>
            </SidebarProvider>
          </ProjectContextProvider>
        </BreadcrumbProvider>
      </ShellBootstrapProvider>
    </AuthGuard>
  );
}
