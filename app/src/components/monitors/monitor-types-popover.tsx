import { Globe } from "lucide-react";
import { InfoPopover } from "@/components/ui/info-popover";
import { monitorTypes } from "./data";

export function MonitorTypesPopover() {
  return (
    <InfoPopover
      label="About uptime monitor types"
      title="Uptime Monitor Types"
      icon={Globe}
      side="right"
      items={monitorTypes.map((type) => ({
        icon: type.icon,
        iconClassName: type.color,
        title: type.label,
        description: type.description,
      }))}
    />
  );
}
