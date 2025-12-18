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
import { ProjectContextProvider } from "@/hooks/use-project-context";
import { NavUser } from "@/components/nav-user";
import { DemoBadge } from "@/components/demo-badge";
import { SubscriptionGuard } from "@/components/subscription-guard";
import { AuthGuard } from "@/components/auth-guard";

/**
 * Main Layout - SYNCHRONOUS (no async)
 * 
 * PERFORMANCE OPTIMIZATION:
 * - Layout is NOT async - prevents client component remounts on navigation
 * - Auth check moved to AuthGuard client component (runs once per session)
 * - All providers persist across navigations
 * 
 * Why this matters:
 * - Async layouts cause React to potentially remount client components
 * - Each remount triggers expensive API calls (projects, billing, executions)
 * - Synchronous layout + client-side auth = fast navigation
 */
export default function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthGuard>
      <BreadcrumbProvider>
        <ProjectContextProvider>
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

