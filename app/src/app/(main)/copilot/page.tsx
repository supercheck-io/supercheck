import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";

import { sreIncidents } from "@/db/schema";
import { requireProjectContext } from "@/lib/project-context";
import { db } from "@/utils/db";

import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreCopilotPageClient } from "@/components/sre/sre-copilot-page-client";

export const metadata = { title: "Copilot | Supercheck" };

export default async function SreAiPage({
  searchParams,
}: {
  searchParams: Promise<{ incident?: string | string[] }>;
}) {
  const { incident } = await searchParams;
  const parsed = z.string().uuid().optional().safeParse(incident);
  if (!parsed.success) notFound();
  if (parsed.data) {
    // A missing or foreign incident 404s here instead of rendering an incident-scoped chat that fails on send.
    const { organizationId, project } = await requireProjectContext();
    const incident = await db.query.sreIncidents.findFirst({
      where: and(
        eq(sreIncidents.id, parsed.data),
        eq(sreIncidents.organizationId, organizationId),
        eq(sreIncidents.projectId, project.id),
      ),
      columns: { id: true },
    });
    if (!incident) notFound();
  }
  return (
    <div data-fit-viewport className="flex min-h-[560px] flex-1 flex-col overflow-hidden lg:min-h-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="sr-only">
        <PageBreadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Copilot", isCurrentPage: true },
          ]}
        />
      </div>
      <SreCopilotPageClient initialIncidentId={parsed.data ?? null} />
    </div>
  );
}
