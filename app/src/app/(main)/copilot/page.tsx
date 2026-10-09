import { notFound } from "next/navigation";
import { z } from "zod";

import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreCopilotPageClient } from "@/components/sre/sre-copilot-page-client";

export default async function SreAiPage({
  searchParams,
}: {
  searchParams: Promise<{ incident?: string | string[] }>;
}) {
  const { incident } = await searchParams;
  const parsed = z.string().uuid().optional().safeParse(incident);
  if (!parsed.success) notFound();
  return (
    <div className="h-[calc(100svh-3.5rem)] overflow-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="sr-only">
        <PageBreadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Investigate", href: "/incidents" },
            { label: "Copilot", isCurrentPage: true },
          ]}
        />
      </div>
      <SreCopilotPageClient initialIncidentId={parsed.data ?? null} />
    </div>
  );
}
