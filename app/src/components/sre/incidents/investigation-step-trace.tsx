import { Check, ChevronRight, CircleAlert, CircleDashed, ListChecks, Loader2 } from "lucide-react";

import { IconTile } from "@/components/sre/incidents/incident-ui";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TableBadge } from "@/components/ui/table-badge";
import type { SreInvestigationStep } from "@/sre/lib/investigation-trace";

const statusIcon = {
  ok: <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />,
  empty: <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />,
  error: <CircleAlert className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />,
} as const;

const statusLabel = { ok: "OK", empty: "No results", error: "Failed" } as const;

/**
 * "How it was investigated": the sanitized step trace. Open while the run is live,
 * collapsed once it is done.
 */
export function InvestigationStepTrace({
  steps,
  running,
}: {
  steps: SreInvestigationStep[];
  running: boolean;
}) {
  if (steps.length === 0 && !running) return null;
  const failures = steps.filter((step) => step.status === "error").length;

  return (
    <Collapsible defaultOpen={running} className="rounded-lg border" data-testid="investigation-step-trace">
      <CollapsibleTrigger className="group flex w-full cursor-pointer flex-wrap items-center gap-2 rounded-lg text-left px-3 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <IconTile icon={ListChecks} tone="slate" />
        How it was investigated
        <span className="text-xs font-normal text-muted-foreground">
          {steps.length} {steps.length === 1 ? "step" : "steps"}
          {failures > 0 ? `, ${failures} failed` : ""}
        </span>
        <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
        {running && (
          <TableBadge tone="info" compact className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Live
          </TableBadge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="space-y-1.5 border-t px-4 py-3" aria-live={running ? "polite" : "off"}>
          {steps.length === 0 && (
            <li className="text-sm text-muted-foreground">Starting. Steps appear here as they finish.</li>
          )}
          {steps.map((step) => (
            <li key={step.index} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                {statusIcon[step.status]}
                <span className="sr-only">{statusLabel[step.status]}: </span>
                {step.tool.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}
              </span>
              {step.args && (
                <span className="min-w-0 break-all text-xs text-muted-foreground">{step.args}</span>
              )}
              <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                {step.resultCount !== null ? `${step.resultCount} ${step.resultCount === 1 ? "result" : "results"}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
