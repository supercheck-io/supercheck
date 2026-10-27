"use client";

import Link from "next/link";

import { useSreSimilarIncidents } from "@/hooks/use-sre";
import { InfoTip } from "@/components/ui/info-tip";
import { TableBadge } from "@/components/ui/table-badge";

const MATCH_LABEL = { service: "Same service", alert: "Same alert source", title: "Similar title" } as const;

/** Resolved incidents from the last 180 days that look related. History only; may be unrelated. */
export function SimilarIncidentsCard({ incidentId }: { incidentId: string }) {
  const { data } = useSreSimilarIncidents(incidentId);
  const incidents = data?.success ? data.incidents : [];
  // Nothing to show while loading, on error, or when there are no matches.
  if (incidents.length === 0) return null;
  return (
    <section data-testid="similar-incidents" aria-labelledby="similar-incidents-title" className="space-y-2">
      <h3 id="similar-incidents-title" className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Similar
        <InfoTip label="About similar incidents">Past incidents on the same service with a similar title.</InfoTip>
      </h3>
      <ul className="space-y-2.5">
        {incidents.map((incident) => (
          <li key={incident.id} className="space-y-1 text-sm">
            <Link
              href={`/incidents/${incident.id}`}
              className="block break-words font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              #{incident.incidentNumber} {incident.title}
            </Link>
            <div className="flex flex-wrap gap-1">
              {incident.matchedOn.map((match) => (
                <TableBadge key={match} compact tone="slate">
                  {MATCH_LABEL[match]}
                </TableBadge>
              ))}
            </div>
            {(incident.rootCauseSummary || incident.resolutionSummary) && (
              <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                {incident.resolutionSummary ?? incident.rootCauseSummary}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
