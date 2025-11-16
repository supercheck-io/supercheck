"use client";

import { usePathname, useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { GitBranch, Logs, Network } from "lucide-react";
import { useBreadcrumbs } from "@/components/breadcrumb-context";
import { useEffect } from "react";

const tabs = [
  { name: "Traces", href: "/observability/traces", value: "traces", icon: GitBranch },
  { name: "Logs", href: "/observability/logs", value: "logs", icon: Logs },
  { name: "Services", href: "/observability/services", value: "services", icon: Network },
];

/**
 * ObservabilityNavTabs
 * Tab-based navigation for observability pages
 */
export function ObservabilityNavTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const { setBreadcrumbs } = useBreadcrumbs();

  // Clear breadcrumbs when this component is active
  useEffect(() => {
    setBreadcrumbs([]);
    return () => {
      setBreadcrumbs([]);
    };
  }, [setBreadcrumbs]);

  // Determine active tab based on pathname
  const activeTab = tabs.find(
    (tab) => pathname === tab.href || (tab.href !== "/observability" && pathname.startsWith(tab.href))
  )?.value || "traces";

  return (
    <Tabs value={activeTab} onValueChange={(value) => {
      const tab = tabs.find((t) => t.value === value);
      if (tab) {
        router.push(tab.href);
      }
    }} className="w-full">
      <TabsList className="bg-muted/50 h-9 p-1 ">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <TabsTrigger key={tab.value} value={tab.value} className="text-xs gap-2 data-[state=active]:bg-background">
              <Icon className="h-4 w-4" />
              {tab.name}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
