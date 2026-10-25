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
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4 ">
        <CardContent>
          <Suspense fallback={null}>
            <RunsViewTabs />
          </Suspense>
        </CardContent>
      </Card> 
    </div>
  );
}
