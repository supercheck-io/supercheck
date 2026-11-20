"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Runs } from "@/components/runs";
import { Skeleton } from "@/components/ui/skeleton";
import { K6Logo } from "@/components/logo/k6-logo";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { parseRunsView, type RunsView } from "./runs-view";
import { useProjectContext } from "@/hooks/use-project-context";
import { NAV } from "@/lib/nav-areas";

// The analytics tabs carry the charting library; load it only when one of them is opened.
const analyticsLoading = () => <Skeleton className="h-96 w-full" />;
const K6AnalyticsView = dynamic(
  () => import("@/components/runs/analytics/k6-analytics-view").then((m) => m.K6AnalyticsView),
  { loading: analyticsLoading },
);
const PlaywrightAnalyticsView = dynamic(
  () => import("@/components/runs/analytics/playwright-analytics-view").then((m) => m.PlaywrightAnalyticsView),
  { loading: analyticsLoading },
);

/** Runs page tabs; the active view lives in the URL as `?view=all|k6|playwright`. */
export function RunsViewTabs() {
  const { currentProject } = useProjectContext();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = parseRunsView(searchParams.get("view"));

  const handleViewChange = (value: string) => {
    const next = parseRunsView(value);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("view");
    else params.set("view", next satisfies RunsView);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <Tabs value={view} onValueChange={handleViewChange} className="space-y-4">
      <PageHeader
        title="Runs"
        icon={NAV.runs.icon}
        tone={NAV.runs.tone}
        description="Job run history, with k6 and Playwright analytics."
        actions={
          <TabsList>
            <TabsTrigger value="all" className="gap-2">
              <ClipboardList className="h-4 w-4" />
              All runs
            </TabsTrigger>
            <TabsTrigger value="k6" className="gap-2">
              <K6Logo className="h-4 w-4" />
              Performance (k6)
            </TabsTrigger>
            <TabsTrigger value="playwright" className="gap-2">
              <PlaywrightLogo className="h-4 w-4" />
              Browser (Playwright)
            </TabsTrigger>
          </TabsList>
        }
      />
      <TabsContent value="all">
        <Runs />
      </TabsContent>
      <TabsContent value="k6">
        <K6AnalyticsView key={currentProject?.id ?? "no-project"} />
      </TabsContent>
      <TabsContent value="playwright">
        <PlaywrightAnalyticsView key={currentProject?.id ?? "no-project"} />
      </TabsContent>
    </Tabs>
  );
}
