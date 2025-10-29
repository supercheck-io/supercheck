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
import { SchedulerInitializer } from "@/components/scheduler-initializer";
import { CommandSearch } from "@/components/ui/command-search";
import { SetupChecker } from "@/components/setup-checker";
import { ProjectContextProvider } from "@/hooks/use-project-context";
import { auth } from "@/utils/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NavUser } from "@/components/nav-user";
import { DemoBadge } from "@/components/demo-badge";

export default async function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth.api.getSession({
    headers: await headers()
  });

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <BreadcrumbProvider >
      <ProjectContextProvider>
        <SidebarProvider>
          <JobProvider>
            {/* Initialize job scheduler */}
            <SchedulerInitializer />
            {/* Check and setup defaults for new users */}
            <SetupChecker />
            <AppSidebar />
          <SidebarInset>
            <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
              <div className="flex items-center gap-2 px-4">
                <SidebarTrigger className="-ml-1" />
                <Separator
                  orientation="vertical"
                  className="mr-2 data-[orientation=vertical]:h-4"
                />
                <BreadcrumbDisplay />
              </div>
              <div className="flex items-center gap-10 px-4">
                <DemoBadge isDemoMode={process.env.NEXT_PUBLIC_DEMO_MODE === "true"} />
                <CommandSearch />
                <ParallelThreads />
                <NavUser />
           
              </div>
            </header>
            <main className="flex-1 flex-col gap-4 p-2 overflow-y-auto">
              {children}
            </main>
          </SidebarInset>
        </JobProvider>
      </SidebarProvider>
    </ProjectContextProvider>
  </BreadcrumbProvider>
    
  );
}
