import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { EvidenceDetailsDialog } from "@/components/sre/incidents/evidence-details-dialog";
import { InvestigationFeedback } from "@/components/sre/incidents/investigation-feedback";
import { CircleCheck, CircleHelp, CircleX, Lightbulb, type LucideIcon } from "lucide-react";

import { SectionTitle } from "@/components/sre/incidents/incident-ui";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { cn } from "@/lib/utils";
import type { SreHypothesisState } from "@/sre/lib/investigation-output";

// The icon and badge carry the state at a glance; ruled-out hypotheses recede.
const STATE: Record<SreHypothesisState, { label: string; tone: TableBadgeTone; icon: LucideIcon; iconClass: string }> = {
  validated: { label: "Validated", tone: "success", icon: CircleCheck, iconClass: "text-emerald-600 dark:text-emerald-400" },
  ruled_out: { label: "Ruled out", tone: "slate", icon: CircleX, iconClass: "text-muted-foreground" },
  inconclusive: { label: "Inconclusive", tone: "warning", icon: CircleHelp, iconClass: "text-amber-600 dark:text-amber-400" },
};

type Investigation = NonNullable<SreIncidentDetail["latestInvestigation"]>;

/** Ranked hypotheses with state badges, evidence citations and per-hypothesis feedback. */
export function InvestigationHypotheses({
  incidentId,
  investigation,
  evidence,
  canGiveFeedback,
}: {
  incidentId: string;
  investigation: Investigation;
  evidence: SreIncidentDetail["evidence"];
  canGiveFeedback: boolean;
}) {
  const { hypotheses } = investigation;
  if (investigation.status !== "completed" || hypotheses.length === 0) return null;
  const feedbackFor = (key: string | null) =>
    investigation.myFeedback.find((entry) => entry.hypothesisKey === key) ?? null;

  return (
    <section aria-labelledby="investigation-hypotheses-title" className="space-y-3">
      <SectionTitle id="investigation-hypotheses-title" icon={Lightbulb} tone="amber" count={hypotheses.length}>
        Hypotheses
      </SectionTitle>
      <ol className="divide-y rounded-lg border">
        {hypotheses.map((hypothesis, index) => {
          const state = STATE[hypothesis.state];
          const cited = hypothesis.evidenceIds
            .map((id) => evidence.find((item) => item.id === id))
            .filter((item): item is SreIncidentDetail["evidence"][number] => Boolean(item));
          return (
            <li
              key={hypothesis.key}
              className="space-y-1.5 px-4 py-3"
              data-testid={`hypothesis-${hypothesis.key}`}
            >
              <div className="flex flex-wrap items-start gap-2">
                <state.icon className={cn("mt-0.5 size-4 shrink-0", state.iconClass)} aria-hidden="true" />
                <p
                  className={cn(
                    "min-w-0 flex-1 break-words text-sm font-medium",
                    hypothesis.state === "ruled_out" && "text-muted-foreground",
                  )}
                >
                  <span className="sr-only">{index + 1}. </span>
                  {hypothesis.title}
                </p>
                <TableBadge tone={state.tone} compact>
                  {state.label}
                </TableBadge>
              </div>
              {hypothesis.rationale && (
                <p className="break-words pl-6 text-sm text-muted-foreground">{hypothesis.rationale}</p>
              )}
              {(cited.length > 0 || canGiveFeedback) && (
                <div className="flex flex-wrap items-center justify-between gap-2 pl-6">
                  {cited.length > 0 && (
                    <div className="flex min-w-0 flex-wrap gap-1.5" aria-label={`Evidence for ${hypothesis.title}`}>
                      {cited.map((item) => (
                        <EvidenceDetailsDialog key={item.id} item={item}>
                          <button
                            type="button"
                            aria-label={`View evidence: ${item.title}`}
                            className="max-w-full truncate rounded-md border bg-muted/40 px-2 py-0.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-[14rem]"
                          >
                            {item.title}
                          </button>
                        </EvidenceDetailsDialog>
                      ))}
                    </div>
                  )}
                  {canGiveFeedback && (
                    <InvestigationFeedback
                      incidentId={incidentId}
                      investigationRunId={investigation.id}
                      hypothesisKey={hypothesis.key}
                      initial={feedbackFor(hypothesis.key)}
                      label={hypothesis.title}
                      compact
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
