import { getIncidentDetail } from "@/actions/get-incident-detail";
import { getStatusPage } from "@/actions/get-status-page";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { PublicIncidentDetail } from "@/components/status-pages/public-incident-detail";
import { redirect } from "next/navigation";

type IncidentDetailPageProps = {
  params: Promise<{
    id: string;
    incidentId: string;
  }>;
};

export default async function IncidentDetailPage({
  params,
}: IncidentDetailPageProps) {
  const resolvedParams = await params;
  const result = await getIncidentDetail(resolvedParams.incidentId);
  const statusPageResult = await getStatusPage(resolvedParams.id);

  if (!result.success || !result.incident) {
    redirect(`/status-pages/${resolvedParams.id}/public`);
  }

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Status Pages", href: "/status-pages" },
    { label: result.incident.name, isCurrentPage: true },
  ];

  return (
    <>
      <PageBreadcrumbs items={breadcrumbs} />
      <PublicIncidentDetail
        incident={result.incident}
        idOrSubdomain={resolvedParams.id}
        transactionalLogo={statusPageResult.success ? statusPageResult.statusPage?.transactionalLogo : undefined}
        statusPageHeadline={statusPageResult.success ? statusPageResult.statusPage?.headline : undefined}
        isPublicView={false}
      />
    </>
  );
}
