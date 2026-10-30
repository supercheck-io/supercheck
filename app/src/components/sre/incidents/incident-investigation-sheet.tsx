"use client";

import type { LucideIcon } from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type InvestigationTab = {
  id: string;
  title: string;
  icon: LucideIcon;
  /** Tabs without content for this incident are left out. */
  content: React.ReactNode | null;
};

/** Right-hand sheet behind "Investigation details": one tab per topic, so only one thing shows at a time. */
export function IncidentInvestigationSheet({
  open,
  onOpenChange,
  tabs,
  tab,
  onTabChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabs: InvestigationTab[];
  tab: string;
  onTabChange: (tab: string) => void;
}) {
  const available = tabs.filter((item) => item.content !== null);
  const active = available.some((item) => item.id === tab) ? tab : (available[0]?.id ?? "");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-[600px] md:max-w-[700px] lg:max-w-[800px] xl:max-w-[950px]" data-testid="investigation-sheet">
        <SheetHeader className="border-b px-6 pr-12">
          <SheetTitle>Investigation details</SheetTitle>
          <SheetDescription>What the AI checked, the evidence it used, and related history.</SheetDescription>
        </SheetHeader>
        <Tabs value={active} onValueChange={onTabChange} className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="overflow-x-auto border-b px-6 py-3">
            <TabsList>
              {available.map(({ id, title, icon: Icon }) => (
                <TabsTrigger key={id} value={id} className="gap-2">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {title}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {available.map((item) => (
              <TabsContent key={item.id} value={item.id} className="mt-0 space-y-6">
                {item.content}
              </TabsContent>
            ))}
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
