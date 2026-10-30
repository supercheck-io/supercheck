"use client";

import Link from "next/link";

import { useSreSimilarIncidents } from "@/hooks/use-sre";
import { TableBadge } from "@/components/ui/table-badge";

const MATCH_LABEL = { service: "Same service", alert: "Same alert source", title: "Similar title" } as const;

/** How many resolved incidents look related; null while loading or on error. */
export function useSimilarIncidentCount(incidentId: string) {
  const { data } = useSreSimilarIncidents(incidentId);
  return data?.success ? data.incidents.length : null;
}

/** Resolved incidents from the last 180 days that look related. History only; may be unrelated. */
export function SimilarIncidentsList({ incidentId }: { incidentId: string }) {
  const { data, isPending } = useSreSimilarIncidents(incidentId);
  if (isPending) return <p className="text-sm text-muted-foreground">Looking for similar incidents...</p>;
  if (!data?.success) return <p className="text-sm text-muted-foreground">Similar incidents are unavailable right now.</p>;
  if (data.incidents.length === 0) {
    return <p className="text-sm text-muted-foreground">No similar resolved incidents in the last 180 days.</p>;
  }
  return (
    <div data-testid="similar-incidents" className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Resolved incidents from the last 180 days that share a service, alert source or title. They may be unrelated.
      </p>
      <ul className="divide-y rounded-lg border">
        {data.incidents.map((incident) => (
          <li key={incident.id} className="space-y-1.5 p-3 text-sm">
            <Link
              href={`/incidents/${incident.id}`}
              className="block break-words font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="mr-1.5 text-muted-foreground">#{incident.incidentNumber}</span>
              {incident.title}
            </Link>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {incident.serviceName && <span>{incident.serviceName}</span>}
              {incident.matchedOn.map((match) => (
                <TableBadge key={match} compact tone="slate">
                  {MATCH_LABEL[match]}
                </TableBadge>
              ))}
            </div>
            {(incident.resolutionSummary || incident.rootCauseSummary) && (
              <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                {incident.resolutionSummary ?? incident.rootCauseSummary}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
