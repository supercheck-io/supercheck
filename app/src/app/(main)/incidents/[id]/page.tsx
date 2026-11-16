import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { sreIncidents } from "@/db/schema";
import { db } from "@/utils/db";
import { requireSreApiPermissions } from "@/app/api/sre/_auth";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { SreIncidentDetailPageClient } from "@/components/sre/incidents/sre-incident-detail-page-client";
import type { IncidentTabParam } from "@/components/sre/incidents/sre-incident-detail-view";

type Params = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
};

const TABS: readonly IncidentTabParam[] = ["overview", "investigation", "postmortem", "evidence", "brief"];

function parseIncidentTab(value: string | string[] | undefined): IncidentTabParam {
  const tab = Array.isArray(value) ? value[0] : value;
  return TABS.find((known) => known === tab) ?? "overview";
}

/** The tab shows the incident title, read with the same permission and project scope as GET /api/sre/incidents/[id]. */
export async function generateMetadata({ params }: Pick<Params, "params">): Promise<Metadata> {
  const fallback = { title: "Incident | Supercheck" };
  try {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fallback;
    const auth = await requireSreApiPermissions([{ resource: "sre_incident", action: "view" }]);
    if (!auth.success) return fallback;
    const [incident] = await db
      .select({ title: sreIncidents.title })
      .from(sreIncidents)
      .where(and(
        eq(sreIncidents.id, id),
        eq(sreIncidents.organizationId, auth.context.organizationId),
        eq(sreIncidents.projectId, auth.context.project.id),
      ))
      .limit(1);
    return incident ? { title: `${incident.title} | Supercheck` } : fallback;
  } catch {
    return fallback;
  }
}

export default async function SreIncidentDetailPage({
  params,
  searchParams,
}: Params) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const initialTab = parseIncidentTab(resolvedSearchParams.tab);
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Incidents", href: "/incidents" },
    { label: "Incident", isCurrentPage: true },
  ];

  return (
    // On desktop the page fits the window (no page scrollbar); each column scrolls on its own.
    <div data-fit-viewport className="flex min-h-0 flex-1 flex-col lg:min-h-[560px] lg:overflow-hidden">
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="m-4 flex min-h-0 min-w-0 flex-1 flex-col shadow-sm">
        <CardContent className="flex min-h-0 flex-1 flex-col p-4 lg:p-6">
          <SreIncidentDetailPageClient incidentId={id} initialTab={initialTab} />
        </CardContent>
      </Card>
    </div>
  );
}
