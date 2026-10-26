import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { EvidenceDetailsDialog } from "@/components/sre/incidents/evidence-details-dialog";
import { InvestigationFeedback } from "@/components/sre/incidents/investigation-feedback";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import type { SreHypothesisState } from "@/sre/lib/investigation-output";

const STATE: Record<SreHypothesisState, { label: string; tone: TableBadgeTone }> = {
  validated: { label: "Validated", tone: "success" },
  ruled_out: { label: "Ruled out", tone: "slate" },
  inconclusive: { label: "Inconclusive", tone: "warning" },
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
      <h3 id="investigation-hypotheses-title" className="text-sm font-medium">
        Hypotheses
      </h3>
      <ol className="divide-y rounded-lg border">
        {hypotheses.map((hypothesis, index) => {
          const state = STATE[hypothesis.state];
          const cited = hypothesis.evidenceIds
            .map((id) => evidence.find((item) => item.id === id))
            .filter((item): item is SreIncidentDetail["evidence"][number] => Boolean(item));
          return (
            <li key={hypothesis.key} className="space-y-2 p-3" data-testid={`hypothesis-${hypothesis.key}`}>
              <div className="flex flex-wrap items-start gap-2">
                <span className="mt-0.5 text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
                <p className="min-w-0 flex-1 break-words text-sm font-medium">{hypothesis.title}</p>
                <TableBadge tone={state.tone} compact>
                  {state.label}
                </TableBadge>
              </div>
              {hypothesis.rationale && (
                <p className="break-words text-sm text-muted-foreground">{hypothesis.rationale}</p>
              )}
              {cited.length > 0 && (
                <div className="flex flex-wrap gap-1.5" aria-label={`Evidence for ${hypothesis.title}`}>
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
            </li>
          );
        })}
      </ol>
    </section>
  );
}
