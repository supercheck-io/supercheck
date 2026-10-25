import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Suspense } from "react";
import { RunsViewTabs } from "@/components/runs/runs-view-tabs";
import { Card, CardContent } from "@/components/ui/card";

export default async function RunsPage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Runs", isCurrentPage: true },
  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm m-4">
        <CardContent className="p-6">
          <Suspense fallback={null}>
            <RunsViewTabs />
          </Suspense>
        </CardContent>
      </Card> 
    </div>
  );
}
