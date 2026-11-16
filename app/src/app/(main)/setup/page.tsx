import { Suspense } from "react";

import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SetupPage, SetupSkeleton } from "@/components/setup/setup-page";
import { Card, CardContent } from "@/components/ui/card";

export default function ProjectSetupPage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Project setup", isCurrentPage: true },
  ];
  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm m-4">
        <CardContent className="p-6">
          <Suspense fallback={<SetupSkeleton />}>
            <SetupPage />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
