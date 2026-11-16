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
      <Card className="m-4 shadow-sm">
        <CardContent className="p-6">
          <Tests />
        </CardContent>
      </Card>
    </div>
  );
} 