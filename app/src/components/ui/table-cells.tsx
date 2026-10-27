import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Date cell shared by every table: calendar icon, short date, muted time, one line. */
export function DateCell({
  value,
  empty = "Never",
  showTime = true,
  className,
}: {
  value: Date | string | null | undefined;
  empty?: string;
  showTime?: boolean;
  className?: string;
}) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return (
      <span className={cn("text-sm text-muted-foreground", className)}>
        {empty}
      </span>
    );
  }
  return (
    <div
      className={cn("flex items-center whitespace-nowrap text-sm", className)}
      suppressHydrationWarning
    >
      <CalendarIcon className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
      <span>
        {date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </span>
      {showTime && (
        <span className="ml-1 text-xs text-muted-foreground">
          {date.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      )}
    </div>
  );
}
