"use client";

import { Fragment } from "react";
import { Loader2, MoreHorizontal, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface RowAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** The "⋯" row menu used by the status page tables. Destructive actions go last, after a separator. */
export function RowActionsMenu({
  actions,
  label,
  busy = false,
}: {
  actions: RowAction[];
  /** Accessible name for the trigger, e.g. "Actions for API Server". */
  label: string;
  busy?: boolean;
}) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-8 w-8 p-0 data-[state=open]:bg-muted"
          aria-label={label}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MoreHorizontal className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {actions.map((action, i) => (
          <Fragment key={action.label}>
            {action.destructive && i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onSelect={action.onSelect}
              disabled={action.disabled}
              className={action.destructive ? "text-failure focus:text-failure" : undefined}
            >
              <action.icon className="mr-2 h-4 w-4" />
              {action.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
