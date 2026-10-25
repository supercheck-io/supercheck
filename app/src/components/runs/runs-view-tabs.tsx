"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Runs } from "@/components/runs";
import { K6AnalyticsView } from "@/components/runs/analytics/k6-analytics-view";
import { PlaywrightAnalyticsView } from "@/components/runs/analytics/playwright-analytics-view";
import { K6Logo } from "@/components/logo/k6-logo";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { parseRunsView, type RunsView } from "./runs-view";

/** Runs page tabs; the active view lives in the URL as `?view=all|k6|playwright`. */
export function RunsViewTabs() {
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
    <Tabs value={view} onValueChange={handleViewChange} className="mt-4">
      <TabsList>
        <TabsTrigger value="all">All runs</TabsTrigger>
        <TabsTrigger value="k6" className="gap-2">
          <K6Logo className="h-4 w-4" />
          Performance (k6)
        </TabsTrigger>
        <TabsTrigger value="playwright" className="gap-2">
          <PlaywrightLogo className="h-4 w-4" />
          Browser (Playwright)
        </TabsTrigger>
      </TabsList>
      <TabsContent value="all">
        <Runs />
      </TabsContent>
      <TabsContent value="k6" className="mt-4">
        <K6AnalyticsView />
      </TabsContent>
      <TabsContent value="playwright" className="mt-4">
        <PlaywrightAnalyticsView />
      </TabsContent>
    </Tabs>
  );
}
