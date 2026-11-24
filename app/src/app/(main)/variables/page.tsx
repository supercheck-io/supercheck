import { Suspense } from "react";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import Variables from "@/components/variables";
import { Card, CardContent } from "@/components/ui/card";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";

export default function VariablesPage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Variables", isCurrentPage: true },
  ];
  return (
    <div data-fit-fill className="flex flex-1 flex-col">
      <PageBreadcrumbs items={breadcrumbs} />
      <Card data-fit-fill className="m-4 shadow-sm flex-1">
        <CardContent className="p-6">
          {/* Suspense boundary required because Variables DataTable toolbar uses useSearchParams() */}
          <Suspense
            fallback={
              <div className="flex min-h-[400px] items-center justify-center">
                <SupercheckLoading size="md" message="Loading variables..." />
              </div>
            }
          >
            <Variables />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}