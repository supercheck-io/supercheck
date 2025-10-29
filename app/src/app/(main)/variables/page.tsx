import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import Variables from "@/components/variables";
import { Card, CardContent } from "@/components/ui/card";

export default function VariablesPage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Variables", isCurrentPage: true },
  ];
  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent>
          <Variables />
        </CardContent>
      </Card>
    </div>
  );
}