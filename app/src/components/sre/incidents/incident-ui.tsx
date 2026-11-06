import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Sections inside the page card: bordered, no shadow, so the page reads as one surface. */
export const PANEL = "shadow-none";

export type IconTone = "violet" | "amber" | "blue" | "emerald" | "rose" | "slate" | "indigo" | "sky";

// Same palette steps as TableBadge, so icon tiles and badges read as one system in light and dark.
const ICON_TONE: Record<IconTone, string> = {
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  slate: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

/** A small tinted square holding an icon; marks a section or an event type. */
export function IconTile({ icon: Icon, tone, className }: { icon: LucideIcon; tone: IconTone; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md", ICON_TONE[tone], className)}>
      <Icon className="size-3.5" />
    </span>
  );
}

/** Section heading used across the incident page: icon tile, title, optional count and a right-hand action. */
export function SectionTitle({
  id,
  icon,
  tone,
  count,
  action,
  as: Heading = "h3",
  children,
}: {
  id?: string;
  icon: LucideIcon;
  tone: IconTone;
  count?: number | null;
  action?: React.ReactNode;
  as?: "h2" | "h3";
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
      <Heading id={id} className="flex items-center gap-2 text-sm font-semibold">
        <IconTile icon={icon} tone={tone} />
        {children}
        {typeof count === "number" && (
          <span className="rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">{count}</span>
        )}
      </Heading>
      {action}
    </div>
  );
}
