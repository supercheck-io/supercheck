import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import Tests from "@/components/tests";
import { Card, CardContent } from "@/components/ui/card";

export default function TestsPage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Tests", isCurrentPage: true },
  ];
  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent>
          <Tests />
        </CardContent>
      </Card>
    </div>
  );
} 