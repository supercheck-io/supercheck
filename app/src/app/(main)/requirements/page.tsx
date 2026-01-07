import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import Requirements from "@/components/requirements";
import { Card, CardContent } from "@/components/ui/card";

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
                    <Requirements />
                </CardContent>
            </Card>
        </div>
    );
}
