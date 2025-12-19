import StatusPagesList from "@/components/status-pages/status-pages-list";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { getStatusPages } from "@/actions/get-status-pages";

export const dynamic = "force-dynamic";

export default async function StatusPagesPage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Status Pages", isCurrentPage: true },
  ];

  const result = await getStatusPages();
  const statusPages = result.success ? result.statusPages : [];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent>
          <StatusPagesList initialStatusPages={statusPages} />
        </CardContent>
      </Card>
    </div>
  );
}
