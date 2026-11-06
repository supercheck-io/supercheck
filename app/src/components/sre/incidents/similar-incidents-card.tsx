"use client";

import { useState } from "react";
import Link from "next/link";
import { History } from "lucide-react";

import { SectionTitle } from "@/components/sre/incidents/incident-ui";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TableBadge } from "@/components/ui/table-badge";
import { useSreSimilarIncidents } from "@/hooks/use-sre";

const MATCH_LABEL = { service: "Same service", alert: "Same alert source", title: "Similar title" } as const;

const COLLAPSED = 3;

/**
 * Resolved incidents from the last 180 days that look related, as a card for the page's right-hand column.
 * Shown only when there are matches. History only; a match may be unrelated.
 */
export function SimilarIncidentsCard({ incidentId }: { incidentId: string }) {
  const { data } = useSreSimilarIncidents(incidentId);
  const [showAll, setShowAll] = useState(false);
  if (!data?.success || data.incidents.length === 0) return null;
  const shown = showAll ? data.incidents : data.incidents.slice(0, COLLAPSED);
  return (
    <Card className="gap-3 py-4" data-testid="similar-incidents">
      <CardHeader className="px-4 pt-0 pb-0">
        <SectionTitle as="h2" icon={History} tone="indigo" count={data.incidents.length}>
          Similar incidents
        </SectionTitle>
      </CardHeader>
      <CardContent className="px-4">
        <ul className="-mx-2 space-y-1">
          {shown.map((incident) => (
            <li key={incident.id}>
              <Link
                href={`/incidents/${incident.id}`}
                className="block rounded-md px-2 py-1.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-baseline gap-1.5 text-sm font-medium">
                  <span className="shrink-0 tabular-nums text-muted-foreground">#{incident.incidentNumber}</span>
                  <span className="truncate">{incident.title}</span>
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {incident.matchedOn.map((match) => (
                    <TableBadge key={match} compact tone="indigo" className="h-5 px-1.5">
                      {MATCH_LABEL[match]}
                    </TableBadge>
                  ))}
                </span>
                {(incident.resolutionSummary || incident.rootCauseSummary) && (
                  <span className="mt-1 line-clamp-2 block break-words text-xs text-muted-foreground">
                    {incident.resolutionSummary ?? incident.rootCauseSummary}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
        {data.incidents.length > COLLAPSED && (
          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll((value) => !value)}
            className="mt-2 rounded-sm text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {showAll ? "Show fewer" : `Show all ${data.incidents.length}`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
