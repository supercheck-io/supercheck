import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Runs } from "@/components/runs";
import { Card, CardContent } from "@/components/ui/card";

export default async function RunsPage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Runs", isCurrentPage: true },
  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4 ">
        <CardContent>
          <Runs />
        </CardContent>
      </Card> 
    </div>
  );
}
