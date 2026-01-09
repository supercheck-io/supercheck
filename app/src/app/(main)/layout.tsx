import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";

export const dynamic = "force-dynamic";

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

/**
 * Main Layout - ASYNC Server Component for Performance
 * 
 * PERFORMANCE OPTIMIZATION:
 * - Layout is async - fetches critical data (session, projects) on the server
 * - Pre-fetched data is passed to client components for instant hydration
 * - Eliminates the "checking authentication" and "loading projects" spinners
 * - All providers persist across navigations
 * 
 * SECURITY:
 * - Server-side data fetching uses the same secure getCachedAuthSession()
 * - API routes still enforce authorization independently
 * - This is a performance optimization, not a security bypass
 * 
 * Why this matters:
 * - Client-side waterfall: session check (300ms) -> project fetch (200ms) -> data fetch
 * - Server-side: all fetched in parallel, hydrated instantly on client
 */
export default async function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // PERFORMANCE: Fetch all critical data in parallel on the server
  // This eliminates the client-side waterfall (auth -> projects -> data)
  // RESILIENCE: Wrapped in try-catch to gracefully degrade to client-side fetching on errors
  let user = null;
  let org = null;

  try {
    [user, org] = await Promise.all([
      getCurrentUser(),
      getActiveOrganization(),
    ]);
  } catch (error) {
    // Log error but don't throw - gracefully degrade to client-side fetching
    console.error('[MainLayout] Server-side session fetch failed, falling back to client-side:', error);
  }

  // Prepare hydration data for client components
  let initialProjects: ProjectContext[] = [];
  let initialCurrentProject: ProjectContext | null = null;
  let initialSession: { user: { id: string; name: string; email: string; image?: string | null } } | null = null;

  // Only fetch projects if user is authenticated
  if (user && org) {
    try {
      // Fetch projects and current project context in parallel
      const [projectsResult, currentProjectResult] = await Promise.all([
        getUserProjects(user.id, org.id),
        getCurrentProjectContext(),
      ]);

      // Convert ProjectWithRole[] to ProjectContext[] for hydration
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

      // Prepare session for AuthGuard hydration
      initialSession = {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        }
      };
    } catch (error) {
      // Log error but don't throw - gracefully degrade to client-side fetching
      console.error('[MainLayout] Server-side project fetch failed, falling back to client-side:', error);
      // Reset to trigger client-side fetching
      initialProjects = [];
      initialCurrentProject = null;
      // Keep initialSession - user is guaranteed to be defined in this branch; AuthGuard will revalidate
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
      {/* PERFORMANCE: Preload Monaco editor assets in background */}
      <MonacoPrefetcher />
      {/* SEAMLESS: Auto-connect recorder extension when user is logged in */}
      <RecorderAutoConnect />
      <BreadcrumbProvider>
        <ProjectContextProvider
          initialProjects={initialProjects}
          initialCurrentProject={initialCurrentProject}
        >
          {/* PERFORMANCE: Prefetch all critical data in parallel immediately */}
          {/* Placed inside ProjectContextProvider to enable Phase 2 entity prefetching */}
          <DataPrefetcher />
          <SidebarProvider>
            <JobProvider>
              {/* Check and setup defaults for new users */}
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

