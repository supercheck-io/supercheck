import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface DateTimeCellProps {
  value: string | Date | null | undefined;
  /** Text shown when there is no value, e.g. "Never". */
  emptyLabel?: string;
  className?: string;
}

/**
 * Table cell for a point in time: "Oct 24, 2026" with the time muted beside it.
 * Matches the date cells in the Monitors and Runs tables.
 */
export function DateTimeCell({ value, emptyLabel = "—", className }: DateTimeCellProps) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return <span className="text-muted-foreground">{emptyLabel}</span>;
  }

  return (
    <div className={cn("flex items-center whitespace-nowrap", className)}>
      <CalendarIcon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
      <span suppressHydrationWarning>
        {date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </span>
      <span className="ml-1 text-xs text-muted-foreground" suppressHydrationWarning>
        {date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
      </span>
    </div>
  );
}
