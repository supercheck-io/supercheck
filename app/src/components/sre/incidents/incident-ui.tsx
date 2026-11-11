import { Info, type LucideIcon } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IconChip, type IconTone } from "@/components/ui/icon-chip";

export type { IconTone };

// Violet is kept for AI identity only. AI actions are plain outline buttons whose icon alone carries the colour.
const BUTTON_TONE = {
  violet: "[&_svg]:text-violet-600 dark:[&_svg]:text-violet-400",
} as const;

/** Classes for an outline button that marks an AI action by its icon colour. */
export function toneButton(tone: keyof typeof BUTTON_TONE) {
  return BUTTON_TONE[tone];
}

// The shared Card is block-level with `p-6 pt-0` content; these make it a padded flex column with a real gap.
export const PANEL_CARD = "flex flex-col gap-3 py-4 shadow-none";
export const PANEL_HEADER = "px-4 pt-0 pb-0";
export const PANEL_CONTENT = "px-4 pb-0";

/** Kept for the incident components; new code uses `IconChip` from `@/components/ui/icon-chip`. */
export const IconTile = IconChip;

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
