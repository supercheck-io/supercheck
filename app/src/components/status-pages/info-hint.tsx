"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type InfoHintProps = {
  /** Accessible name for the trigger, e.g. "Domain setup details". */
  label: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  /** Extra classes for the popover panel, e.g. a wider width. */
  contentClassName?: string;
};

/**
 * Small info icon that opens a popover with supporting copy.
 * Keeps long setup instructions out of the primary layout.
 */
export function InfoHint({
  label,
  children,
  side = "top",
  align = "start",
  className,
  contentClassName,
}: InfoHintProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            className,
          )}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={6}
        collisionPadding={16}
        className={cn(
          "w-80 max-w-[calc(100vw-2rem)] space-y-2 text-sm leading-relaxed",
          contentClassName,
        )}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function InfoHintTitle({ children }: { children: ReactNode }) {
  return <p className="text-sm font-medium text-foreground">{children}</p>;
}

export function InfoHintText({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground">{children}</p>;
}

export function InfoHintList({ children }: { children: ReactNode }) {
  return (
    <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground marker:text-muted-foreground/60">
      {children}
    </ul>
  );
}
