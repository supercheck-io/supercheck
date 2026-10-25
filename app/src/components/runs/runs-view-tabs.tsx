"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ClipboardList } from "lucide-react";
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
    <Tabs value={view} onValueChange={handleViewChange} className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Runs</h1>
          <p className="text-muted-foreground text-sm">
            Job run history, with k6 and Playwright analytics.
          </p>
        </div>
        <TabsList className="self-start md:self-auto">
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
      </div>
      <TabsContent value="all">
        <Runs />
      </TabsContent>
      <TabsContent value="k6">
        <K6AnalyticsView />
      </TabsContent>
      <TabsContent value="playwright">
        <PlaywrightAnalyticsView />
      </TabsContent>
    </Tabs>
  );
}
