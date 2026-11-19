"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type InfoHintProps = {
  /** Accessible name for the trigger, e.g. "Domain setup details". */
  label: string;
  /** Header title. */
  title: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  /** Extra classes for the popover panel, e.g. a wider width. */
  contentClassName?: string;
};

/**
 * Info popover for a form field or setup step. The trigger is the info icon, so the panel
 * header is the title alone: a second info icon inside it would only repeat the trigger.
 */
export function InfoHint({ label, title, children, side = "top", align = "start", className, contentClassName }: InfoHintProps) {
  return (
    <Popover>
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
          "max-h-[min(32rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] space-y-1.5 overflow-y-auto",
          contentClassName,
        )}
      >
        <h4 className="text-sm font-semibold">{title}</h4>
        <div className="space-y-2 text-sm leading-relaxed">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

export function InfoHintText({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

export function InfoHintList({ children }: { children: ReactNode }) {
  return (
    <ul className="list-disc space-y-1.5 pl-4 text-xs text-muted-foreground marker:text-muted-foreground/60">
      {children}
    </ul>
  );
}
