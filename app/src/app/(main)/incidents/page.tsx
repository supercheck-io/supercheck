import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreIncidentsPageClient } from "@/components/sre/incidents/sre-incidents-page-client";
import { Card, CardContent } from "@/components/ui/card";

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Alert delivery history moved to Notifications; keep old links working.
  const { tab } = await searchParams;
  if ((Array.isArray(tab) ? tab[0] : tab) === "alerts") redirect("/notifications?tab=history");

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Incidents", isCurrentPage: true },
  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="m-4 min-w-0 overflow-hidden shadow-sm transition-shadow duration-200 hover:shadow-md">
        <CardContent>
          <Suspense fallback={null}>
            <SreIncidentsPageClient />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
