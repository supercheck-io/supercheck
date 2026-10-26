import { Check, CircleAlert, CircleDashed, Loader2 } from "lucide-react";

import { TableBadge } from "@/components/ui/table-badge";
import type { SreInvestigationStep } from "@/sre/lib/investigation-trace";

function formatDuration(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const statusIcon = {
  ok: <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />,
  empty: <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />,
  error: <CircleAlert className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />,
} as const;

const statusLabel = { ok: "OK", empty: "No results", error: "Failed" } as const;

/**
 * "How I investigated": the sanitized tool trace. Open while the run is live,
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
    <details open={running} className="rounded-lg border" data-testid="investigation-step-trace">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        How I investigated
        <span className="text-xs font-normal text-muted-foreground">
          {steps.length} {steps.length === 1 ? "step" : "steps"}
          {failures > 0 ? `, ${failures} failed` : ""}
        </span>
        {running && (
          <TableBadge tone="info" compact className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Live
          </TableBadge>
        )}
      </summary>
      <ol className="space-y-1 border-t px-4 py-3" aria-live={running ? "polite" : "off"}>
        {steps.length === 0 && (
          <li className="text-sm text-muted-foreground">Starting. Steps appear here as they finish.</li>
        )}
        {steps.map((step) => (
          <li key={step.index} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <span className="inline-flex items-center gap-1.5 font-mono text-xs">
              {statusIcon[step.status]}
              <span className="sr-only">{statusLabel[step.status]}: </span>
              {step.tool}
            </span>
            {step.args && (
              <span className="min-w-0 break-all text-xs text-muted-foreground">{step.args}</span>
            )}
            <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground tabular-nums">
              {step.resultCount !== null ? `${step.resultCount} ${step.resultCount === 1 ? "result" : "results"} · ` : ""}
              {formatDuration(step.durationMs)}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
