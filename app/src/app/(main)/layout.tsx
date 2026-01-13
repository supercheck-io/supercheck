import { AppSidebar } from "@/components/app-sidebar";
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
import { SubscriptionGuard } from "@/components/subscription-guard";
import { AuthGuard } from "@/components/auth-guard";
import { DataPrefetcher } from "@/components/data-prefetcher";
import { MonacoPrefetcher } from "@/components/monaco-prefetcher";
import { RecorderAutoConnect } from "@/components/recorder/RecorderAutoConnect";
import { getCurrentUser, getActiveOrganization, getUserProjects } from "@/lib/session";
import { getCurrentProjectContext } from "@/lib/project-context";

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

  if (user && org) {
    try {
      const [projectsResult, currentProjectResult] = await Promise.all([
        getUserProjects(user.id, org.id),
        getCurrentProjectContext(),
      ]);

      initialProjects = projectsResult.map(p => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        organizationId: p.organizationId,
        isDefault: p.isDefault,
        userRole: p.role || 'project_viewer',
      }));

      initialCurrentProject = currentProjectResult;

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

  return (
    <AuthGuard initialSession={initialSession}>
      <MonacoPrefetcher />
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
              <SidebarInset>
                <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-t">
                  <div className="flex items-center gap-2 px-4">
                    <SidebarTrigger className="-ml-1" />
                    <Separator
                      orientation="vertical"
                      className="mr-2 data-[orientation=vertical]:h-4"
                    />
                    <BreadcrumbDisplay />
                  </div>
                  <div className="flex items-center gap-6 px-4">
                    <DemoBadge />
                    <CommandSearch />
                    <ParallelThreads />
                    <NavUser />
                  </div>
                </header>
                <main className="flex-1 flex-col gap-4 overflow-y-auto">
                  <SubscriptionGuard>
                    {children}
                  </SubscriptionGuard>
                </main>
              </SidebarInset>
            </JobProvider>
          </SidebarProvider>
        </ProjectContextProvider>
      </BreadcrumbProvider>
    </AuthGuard>
  );
}

