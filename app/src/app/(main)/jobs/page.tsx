import Jobs from "@/components/jobs";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";

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
          <Jobs />
        </CardContent>
      </Card>
    </div>
  );
} 