import StatusPagesList from "@/components/status-pages/status-pages-list";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";

export default function StatusPagesPage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Status Pages", isCurrentPage: true },
  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent>
          <StatusPagesList />
        </CardContent>
      </Card>
    </div>
  );
}
