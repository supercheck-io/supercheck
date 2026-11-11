import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Product areas from DESIGN.md. Each maps to a CSS token in globals.css. */
export type AreaTone = "automate" | "monitor" | "respond" | "communicate" | "ai";
export type IconTone = AreaTone | "violet" | "amber" | "blue" | "emerald" | "rose" | "slate" | "indigo" | "sky";

// Same palette steps as TableBadge, so icon chips and badges read as one system in light and dark.
const ICON_TONE: Record<IconTone, string> = {
  automate: "bg-automate/10 text-automate",
  monitor: "bg-monitor/10 text-monitor",
  respond: "bg-respond/10 text-respond",
  communicate: "bg-communicate/10 text-communicate",
  ai: "bg-ai/10 text-ai",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  slate: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

const SIZE = {
  sm: { box: "size-6 rounded-md", icon: "size-3.5" },
  md: { box: "size-8 rounded-lg", icon: "size-4" },
} as const;

/** A small tinted square holding an icon; marks a page, section or event type. Decorative only. */
export function IconChip({
  icon: Icon,
  tone,
  size = "sm",
  className,
}: {
  icon: LucideIcon;
  tone: IconTone;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      className={cn("inline-flex shrink-0 items-center justify-center", SIZE[size].box, ICON_TONE[tone], className)}
    >
      <Icon className={SIZE[size].icon} />
    </span>
  );
}
