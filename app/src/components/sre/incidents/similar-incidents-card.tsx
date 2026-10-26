import Link from "next/link";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableBadge } from "@/components/ui/table-badge";

const MATCH_LABEL = { service: "Same service", alert: "Same alert source", title: "Similar title" } as const;

/** Resolved incidents from the last 180 days that look related. History only; may be unrelated. */
export function SimilarIncidentsCard({ incidents }: { incidents: SreIncidentDetail["similarIncidents"] }) {
  return (
    <Card data-testid="similar-incidents">
      <CardHeader>
        <CardTitle className="text-sm">Similar incidents</CardTitle>
      </CardHeader>
      <CardContent>
        {incidents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No similar resolved incidents in the last 180 days.
          </p>
        ) : (
          <>
            <ul className="space-y-3">
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
                    <p className="line-clamp-3 break-words text-xs text-muted-foreground">
                      {incident.resolutionSummary ?? incident.rootCauseSummary}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Past incidents may be unrelated. Check the evidence before reusing a fix.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
