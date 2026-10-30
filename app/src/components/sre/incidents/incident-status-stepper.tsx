import { Check } from "lucide-react";

import { INCIDENT_DISPLAY_STATUSES, type IncidentDisplayStatus } from "@/lib/sre/incident-status-display";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The six display statuses as a read-only progress line. The current one is highlighted. */
export function IncidentStatusStepper({
  current,
  acknowledged = false,
  description,
}: {
  current: IncidentDisplayStatus;
  /** Whether someone acknowledged it; a resolved incident may have skipped the middle steps. */
  acknowledged?: boolean;
  /** Explains the current status; shown as a tooltip on the highlighted step. */
  description?: string;
}) {
  const currentIndex = INCIDENT_DISPLAY_STATUSES.findIndex((status) => status.value === current);
  const lastIndex = INCIDENT_DISPLAY_STATUSES.length - 1;
  return (
    <nav aria-label="Incident progress" className="shrink-0 overflow-x-auto">
      <p aria-hidden="true" className="text-sm font-medium sm:hidden">
        Step {currentIndex + 1} of {INCIDENT_DISPLAY_STATUSES.length} · {INCIDENT_DISPLAY_STATUSES[currentIndex]?.label}
      </p>
      <ol className="sr-only items-center gap-2 text-sm sm:not-sr-only sm:flex sm:min-w-max">
        {INCIDENT_DISPLAY_STATUSES.map((status, index) => {
          // Once resolved we only know it was triggered, maybe acknowledged, and resolved;
          // the steps in between may never have happened, so they are not ticked.
          const isDone = (i: number) =>
            current === "resolved" ? i === 0 || i === lastIndex || (i === 1 && acknowledged) : i < currentIndex;
          const done = isDone(index);
          // A connector is green only between two steps that both happened.
          const nextDone = isDone(index + 1) || index + 1 === currentIndex;
          const active = index === currentIndex;
          return (
            <li
              key={status.value}
              aria-current={active ? "step" : undefined}
              data-state={active ? "current" : done ? "done" : "upcoming"}
              className="flex items-center gap-2"
            >
              {active && description ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold",
                        current === "resolved" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-primary text-primary-foreground",
                      )}
                    >
                      {current === "resolved" && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                      {status.label}
                      {current === "resolved" && <span className="sr-only"> (done)</span>}
                      {/* The list is screen-reader only on phones, so it holds no focus stop; the description is read inline. */}
                      <span className="sr-only">: {description}</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">{description}</TooltipContent>
                </Tooltip>
              ) : (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5",
                    active && (current === "resolved" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-semibold" : "bg-primary font-semibold text-primary-foreground"),
                    done && !active && "text-foreground",
                    !done && !active && "text-muted-foreground",
                  )}
                >
                  {done && !active && (
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-success text-white">
                      <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                    </span>
                  )}
                  {done && active && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                  {status.label}
                  {done && <span className="sr-only"> (done)</span>}
                </span>
              )}
              {index < INCIDENT_DISPLAY_STATUSES.length - 1 && (
                <span aria-hidden="true" className={cn("h-px w-6", done && nextDone ? "bg-success/60" : "bg-border")} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
