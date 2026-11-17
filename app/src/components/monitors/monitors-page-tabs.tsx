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
  // Each tab renders the PageHeader (title, these tabs, its create action) so the empty state can hide the action.
  const tabs = (
    <TabsList>
      <TabsTrigger value="monitors">Monitors</TabsTrigger>
      <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
    </TabsList>
  );
  return (
    <Tabs value={tab} onValueChange={select} activationMode="manual">
      <TabsContent value="monitors" className="mt-0"><MonitorsList tabs={tabs} /></TabsContent>
      <TabsContent value="maintenance" className="mt-0"><MaintenanceWindowsPanel tabs={tabs} /></TabsContent>
    </Tabs>
  );
}
