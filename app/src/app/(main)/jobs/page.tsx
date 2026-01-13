import { Suspense } from "react";
import Jobs from "@/components/jobs";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";

export default function JobsPage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Jobs", isCurrentPage: true },
  ];
  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent>
          {/* Suspense boundary required because Jobs component uses useSearchParams() */}
          <Suspense
            fallback={
              <div className="flex min-h-[400px] items-center justify-center">
                <SuperCheckLoading size="lg" message="Loading jobs..." />
              </div>
            }
          >
            <Jobs />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
} 