"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import MonitorsList from "@/components/monitors/monitors-list";
import { MaintenanceWindowsPanel } from "@/components/maintenance/maintenance-windows-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Monitors page: the monitor list, and maintenance windows at ?tab=maintenance. */
export function MonitorsPageTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") === "maintenance" ? "maintenance" : "monitors";
  const select = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "maintenance") params.set("tab", "maintenance");
    else params.delete("tab");
    params.delete("new");
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  };
  return (
    <Tabs value={tab} onValueChange={select} className="space-y-4">
      <TabsList>
        <TabsTrigger value="monitors">Monitors</TabsTrigger>
        <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
      </TabsList>
      <TabsContent value="monitors"><MonitorsList /></TabsContent>
      <TabsContent value="maintenance"><MaintenanceWindowsPanel /></TabsContent>
    </Tabs>
  );
}
