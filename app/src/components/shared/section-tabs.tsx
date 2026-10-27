"use client";

import type { LucideIcon } from "lucide-react";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface SectionTab {
  value: string;
  label: string;
  icon: LucideIcon;
}

// Full class names so Tailwind can see them.
const BREAKPOINT_CLASSES = {
  lg: { list: "hidden lg:inline-flex", select: "lg:hidden" },
  xl: { list: "hidden xl:inline-flex", select: "xl:hidden" },
} as const;

/**
 * Tab strip for a page header row (render inside <Tabs>). Below `collapseBelow`
 * the tabs become a select so the header never wraps.
 */
export function SectionTabs({
  tabs,
  value,
  onValueChange,
  collapseBelow = "lg",
}: {
  tabs: SectionTab[];
  value: string;
  onValueChange: (value: string) => void;
  collapseBelow?: keyof typeof BREAKPOINT_CLASSES;
}) {
  const classes = BREAKPOINT_CLASSES[collapseBelow];
  return (
    <>
      <TabsList className={classes.list}>
        {tabs.map(({ value: tab, label, icon: Icon }) => (
          <TabsTrigger key={tab} value={tab} className="gap-2">
            <Icon className="h-4 w-4" />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className={classes.select}>
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger className="w-[200px]" aria-label="Section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {tabs.map(({ value: tab, label, icon: Icon }) => (
              <SelectItem key={tab} value={tab}>
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  {label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
