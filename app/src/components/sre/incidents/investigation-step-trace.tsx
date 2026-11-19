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

// Limits and redacted ids say nothing to a reader; they stay in the expanded row.
const NOISE_ARG = /^(?:max[A-Z]\w*|limit|offset)$/;

/** `key=value, key=value` from the stored trace. Values can contain commas (even `,status=`), so split only on ", " before the next `key=`. */
export function parseStepArgs(args: string) {
  if (!args.trim()) return [];
  return args.split(/, (?=[A-Za-z_][\w.-]*=)/).map((pair) => {
    const at = pair.indexOf("=");
    return at === -1 ? { key: "", value: pair.trim() } : { key: pair.slice(0, at).trim(), value: pair.slice(at + 1).trim() };
  });
}

function argLabel(key: string, value: string) {
  if (key === "timeWindowMinutes") return `last ${value} min`;
  return key ? `${key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}: ${value}` : value;
}

/** The arguments worth a glance: no redacted ids, no output limits. */
export function summarizeStepArgs(args: string) {
  return parseStepArgs(args)
    .filter(({ key, value }) => value !== "[redacted]" && !NOISE_ARG.test(key))
    .map(({ key, value }) => argLabel(key, value))
    .join(" · ");
}

function stepName(tool: string) {
  return tool.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/** One step: a one-line summary that expands to every stored argument and the full error. */
function StepRow({ step }: { step: SreInvestigationStep }) {
  const summary = summarizeStepArgs(step.args);
  const all = parseStepArgs(step.args);
  const expandable = all.length > 0 || Boolean(step.error);
  const result = step.resultCount !== null ? `${step.resultCount} ${step.resultCount === 1 ? "result" : "results"}` : "";
  const line = (
    <>
      <span className="mt-0.5 shrink-0">{statusIcon[step.status]}</span>
      <span className="min-w-0 flex-1">
        <span className="sr-only">{statusLabel[step.status]}: </span>
        <span className="text-xs font-medium">{stepName(step.tool)}</span>
        {summary && <span className="block truncate font-mono text-xs text-muted-foreground">{summary}</span>}
        {step.error && <span className="block truncate text-xs text-destructive">{step.error}</span>}
      </span>
      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{result}</span>
    </>
  );
  if (!expandable) return <li className="flex min-w-0 items-start gap-2 px-2 py-1.5">{line}</li>;
  return (
    <li>
      <Collapsible>
        <CollapsibleTrigger className="group/step flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {line}
          <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/step:rotate-90" aria-hidden="true" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <dl className="ml-6 mr-2 mb-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md bg-muted/40 p-2.5 text-xs">
            {all.map(({ key, value }, index) => (
              <div key={`${key}-${index}`} className="contents">
                <dt className="text-muted-foreground">{key || "argument"}</dt>
                <dd className="break-all font-mono">{value}</dd>
              </div>
            ))}
            {step.error && (
              <div className="contents">
                <dt className="text-muted-foreground">Error</dt>
                <dd className="break-words text-destructive">{step.error}</dd>
              </div>
            )}
          </dl>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

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
          {steps.length === 0 && running ? "Starting" : `${steps.length} ${steps.length === 1 ? "step" : "steps"}`}
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
        <ol className="space-y-0.5 border-t px-2 py-2" aria-live={running ? "polite" : "off"}>
          {steps.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">Starting. Steps appear here as they finish.</li>
          )}
          {steps.map((step) => (
            <StepRow key={step.index} step={step} />
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
