import { Bot, Braces, CalendarClock, Globe, Lock, Network, Share2, ShieldHalf, type LucideIcon } from "lucide-react";
import type { ToolId } from "../../lib/tools-funnel";

/** Icon and chip colour of each free tool. Type tones from DESIGN.md; violet (`ai`) only for the agent check. */
export const TOOL_LOOK: Record<ToolId, { icon: LucideIcon; chip: string; text: string }> = {
  uptime: { icon: Globe, chip: "bg-type-cyan/10 text-type-cyan", text: "text-type-cyan" },
  api: { icon: Braces, chip: "bg-type-teal/10 text-type-teal", text: "text-type-teal" },
  https: { icon: Lock, chip: "bg-type-cobalt/10 text-type-cobalt", text: "text-type-cobalt" },
  headers: { icon: ShieldHalf, chip: "bg-type-indigo/10 text-type-indigo", text: "text-type-indigo" },
  agents: { icon: Bot, chip: "bg-ai/10 text-ai", text: "text-ai" },
  dns: { icon: Network, chip: "bg-type-sky/10 text-type-sky", text: "text-type-sky" },
  social: { icon: Share2, chip: "bg-type-orchid/10 text-type-orchid", text: "text-type-orchid" },
  domain: { icon: CalendarClock, chip: "bg-type-fuchsia/10 text-type-fuchsia", text: "text-type-fuchsia" },
};

/** Tinted square with the tool's icon. Decorative: the tool name next to it carries the meaning. */
export function ToolChip({ tool, size = "md" }: { tool: ToolId; size?: "sm" | "md" }) {
  const { icon: Icon, chip } = TOOL_LOOK[tool];
  const box = size === "sm" ? "size-7 rounded-md" : "size-9 rounded-lg";
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center ${box} ${chip}`}>
      <Icon className={size === "sm" ? "size-4" : "size-[18px]"} />
    </span>
  );
}
