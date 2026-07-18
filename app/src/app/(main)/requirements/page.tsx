import { Suspense } from "react";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import Requirements from "@/components/requirements";
import { Card, CardContent } from "@/components/ui/card";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";

export default function RequirementsPage() {
    const breadcrumbs = [
        { label: "Home", href: "/" },
        { label: "Requirements", isCurrentPage: true },
    ];

    return (
        <div>
            <PageBreadcrumbs items={breadcrumbs} />
            <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
                <CardContent>
                    {/* Suspense boundary required because Requirements uses useSearchParams() */}
                    <Suspense
                        fallback={
                            <div className="flex min-h-[400px] items-center justify-center">
                                <SupercheckLoading size="md" message="Loading requirements..." />
                            </div>
                        }
                    >
                        <Requirements />
                    </Suspense>
                </CardContent>
            </Card>
        </div>
    );
}
