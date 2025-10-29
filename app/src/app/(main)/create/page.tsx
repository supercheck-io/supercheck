import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { CreatePageContent } from "@/components/create/create-page-content";
import { Card, CardContent } from "@/components/ui/card";

export default function CreatePage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Quick Create", isCurrentPage: true },
  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent>
          <CreatePageContent />
        </CardContent>
      </Card>
    </div>
  );
}
