import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPageDetail } from "@/components/status-pages/status-page-detail";
import { getStatusPage } from "@/actions/get-status-page";
import { getMonitorsForStatusPage } from "@/actions/get-monitors-for-status-page";
import { getComponents } from "@/actions/get-components";
import { checkStatusPagePermission } from "@/actions/check-status-page-permission";
import { redirect } from "next/navigation";

type StatusPagePageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function StatusPagePage({ params }: StatusPagePageProps) {
  const resolvedParams = await params;
  const result = await getStatusPage(resolvedParams.id);

  if (!result.success || !result.statusPage) {
    redirect("/status-pages");
  }

  // Fetch monitors and components
  const monitorsResult = await getMonitorsForStatusPage();
  const componentsResult = await getComponents(resolvedParams.id);
  const permissionResult = await checkStatusPagePermission();

  // Check if components fetch was successful
  if (!componentsResult.success) {
    console.error("Failed to fetch components:", componentsResult.message);
    // We'll continue with empty components rather than redirecting to avoid breaking the page
  }

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Status Pages", href: "/status-pages" },
    { label: result.statusPage.name, isCurrentPage: true },
  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent className="p-0">
          <StatusPageDetail
            statusPage={result.statusPage}
            monitors={monitorsResult.monitors || []}
            components={componentsResult.components || []}
            canUpdate={permissionResult.canUpdate}
          />
        </CardContent>
      </Card>
    </div>
  );
}
