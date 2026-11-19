"use client";

import type { ComponentType, ReactNode } from "react";
import { Info, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type InfoPopoverItem = {
  icon?: ComponentType<{ className?: string }>;
  /** Tone class for the icon, e.g. `text-success`. Defaults to muted. */
  iconClassName?: string;
  title: string;
  description?: ReactNode;
};

type InfoPopoverProps = {
  /** Accessible name for the trigger (and the panel), e.g. "About notifications". */
  label: string;
  /** Header title. */
  title: string;
  /** Header icon. None by default: the trigger is already an info icon, so repeating it in the panel adds noise. */
  icon?: LucideIcon;
  /** One short sentence under the header. */
  description?: ReactNode;
  /** Rows with an icon, a bold title and a muted description. */
  items?: InfoPopoverItem[];
  /** Short bullets, after the items. */
  bullets?: string[];
  /** Anything else (code samples, scroll lists), after the bullets. */
  children?: ReactNode;
  /** Optional docs link. */
  learnMoreHref?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  contentClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * The one info icon for page, section and form-group help: a click-to-open popover
 * (Escape and outside click close it) with a header, a list of items and an optional docs link.
 * One-sentence field hints use `InfoTip` (a tooltip) instead. See DESIGN.md.
 */
export function InfoPopover({
  label,
  title,
  icon: HeaderIcon,
  description,
  items,
  bullets,
  children,
  learnMoreHref,
  side = "bottom",
  align = "start",
  className,
  contentClassName,
  open,
  onOpenChange,
}: InfoPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={label}
          className={cn("h-6 w-6 shrink-0 rounded-full p-0 text-muted-foreground hover:text-foreground", className)}
        >
          <Info className="h-4 w-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        collisionPadding={16}
        aria-label={label}
        className={cn(
          "max-h-[min(32rem,var(--radix-popover-content-available-height))] w-[28rem] max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto",
          contentClassName,
        )}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {HeaderIcon ? <HeaderIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
            <h4 className="text-sm font-semibold">{title}</h4>
          </div>
          {description ? <p className="text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
        </div>
        {items?.length ? (
          <ul className="space-y-2">
            {items.map(({ icon: ItemIcon, iconClassName, title: itemTitle, description: itemDescription }, index) => (
              <li key={`${index}-${itemTitle}`} className="flex items-start gap-3 rounded-md bg-muted/30 p-2">
                {ItemIcon ? (
                  <ItemIcon
                    className={cn("mt-0.5 h-4 w-4 shrink-0", iconClassName ?? "text-muted-foreground")}
                    aria-hidden="true"
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="text-sm font-medium">{itemTitle}</p>
                  {itemDescription ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">{itemDescription}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {bullets?.length ? (
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground marker:text-muted-foreground/60">
            {bullets.map((bullet, index) => (
              <li key={`${index}-${bullet}`}>{bullet}</li>
            ))}
          </ul>
        ) : null}
        {children}
        {learnMoreHref ? (
          <a
            href={learnMoreHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Learn more
          </a>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
