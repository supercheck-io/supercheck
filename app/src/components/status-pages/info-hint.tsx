"use client";

import type { ReactNode } from "react";

import { InfoPopover } from "@/components/ui/info-popover";
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

/** Info popover for a form field or setup step: the shared InfoPopover, narrower, with free-form content. */
export function InfoHint({ label, title, children, side = "top", align = "start", className, contentClassName }: InfoHintProps) {
  return (
    <InfoPopover
      label={label}
      title={title}
      side={side}
      align={align}
      className={className}
      contentClassName={cn("w-80 space-y-1.5", contentClassName)}
    >
      <div className="space-y-2 text-sm leading-relaxed">{children}</div>
    </InfoPopover>
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
