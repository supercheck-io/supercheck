import { Info, type LucideIcon } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

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

// Tinted secondary buttons in the same palette: violet marks AI actions, sky marks export and save.
// Applied over variant="outline"; primary actions keep the solid default button.
const BUTTON_TONE = {
  violet:
    "border-violet-500/30 bg-violet-500/10 text-violet-700 hover:bg-violet-500/15 hover:text-violet-800 dark:border-violet-400/30 dark:bg-violet-500/15 dark:text-violet-300 dark:hover:bg-violet-500/25 dark:hover:text-violet-200 [&_svg]:text-violet-600 dark:[&_svg]:text-violet-400",
  sky:
    "border-sky-500/30 bg-sky-500/10 text-sky-700 hover:bg-sky-500/15 hover:text-sky-800 dark:border-sky-400/30 dark:bg-sky-500/15 dark:text-sky-300 dark:hover:bg-sky-500/25 dark:hover:text-sky-200 [&_svg]:text-sky-600 dark:[&_svg]:text-sky-400",
} as const;

/** Classes for a subtly coloured outline button. */
export function toneButton(tone: keyof typeof BUTTON_TONE) {
  return BUTTON_TONE[tone];
}

/** A small tinted square holding an icon; marks a section or an event type. */
export function IconTile({ icon: Icon, tone, className }: { icon: LucideIcon; tone: IconTone; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md", ICON_TONE[tone], className)}>
      <Icon className="size-3.5" />
    </span>
  );
}

// Desktop columns scroll inside the page card with the scrollbar hidden, as on Copilot; small screens scroll the page.
export const COLUMN_SCROLL = "lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

// Icons take the tab's text colour; the active tab's icon picks up the primary colour.
export const TAB_TRIGGER = "gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground data-[state=active]:[&_svg]:text-primary";

/** One figure: small label above a prominent value, for a `<dl>` grid. */
export function Metric({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/50 px-2.5 py-2" title={title}>
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums" suppressHydrationWarning>{children}</dd>
    </div>
  );
}

/** Section heading used across the incident page: icon tile, title, optional count and a right-hand action. */
export function SectionTitle({
  id,
  icon,
  tone,
  count,
  hint,
  action,
  as: Heading = "h3",
  children,
}: {
  id?: string;
  icon: LucideIcon;
  tone: IconTone;
  count?: number | null;
  /** One or two sentences shown from a small info button beside the heading, outside it. */
  hint?: string;
  action?: React.ReactNode;
  as?: "h2" | "h3";
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <Heading id={id} className="flex items-center gap-2 text-sm font-semibold">
          <IconTile icon={icon} tone={tone} />
          {children}
          {typeof count === "number" && (
            <span className="rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">{count}</span>
          )}
        </Heading>
        {hint && (
          // A popover, not a tooltip, so a tap on touch screens opens and keeps the hint.
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`About ${typeof children === "string" ? children.toLowerCase() : "this section"}`}
                className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Info className="size-3.5" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto max-w-xs p-3 text-xs">{hint}</PopoverContent>
          </Popover>
        )}
      </div>
      {action}
    </div>
  );
}
