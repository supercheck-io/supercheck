"use client";

import { ListChecks } from "lucide-react";
import { InfoPopover } from "@/components/ui/info-popover";
import { statusPageSteps } from "./data";

export function StatusPageInfoPopover() {
  return (
    <InfoPopover
      label="Quick setup guide"
      title="Quick setup guide"
      icon={ListChecks}
      description="Six steps from draft to a live status page."
      items={statusPageSteps.map((step, index) => ({
        icon: step.icon,
        title: `${index + 1}. ${step.title}`,
        description: step.description,
      }))}
    />
  );
}