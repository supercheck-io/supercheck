import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import Tests from "@/components/tests";
import { Card, CardContent } from "@/components/ui/card";

export default function TestsPage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Tests", isCurrentPage: true },
  ];
  return (
    <div data-fit-fill className="flex flex-1 flex-col">
      <PageBreadcrumbs items={breadcrumbs} />
      <Card data-fit-fill className="m-4 shadow-sm flex-1">
        <CardContent className="p-6">
          <Tests />
        </CardContent>
      </Card>
    </div>
  );
} 