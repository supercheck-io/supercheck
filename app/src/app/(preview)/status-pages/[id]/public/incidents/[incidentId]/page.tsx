import { getIncidentDetail } from "@/actions/get-incident-detail";
import { getStatusPage } from "@/actions/get-status-page";
import { PublicIncidentDetail } from "@/components/status-pages/public-incident-detail";
import { isStatusPageBrandingHidden } from "@/lib/feature-flags";
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

  // An incident of another page in the same project must not show under this page's header.
  if (
    !result.success ||
    !result.incident ||
    result.incident.statusPage?.id !== resolvedParams.id
  ) {
    redirect(`/status-pages/${resolvedParams.id}/public`);
  }

  return (
    <PublicIncidentDetail
      incident={result.incident}
      idOrSubdomain={resolvedParams.id}
      transactionalLogo={
        statusPageResult.success
          ? statusPageResult.statusPage?.transactionalLogo
          : undefined
      }
      statusPageHeadline={
        statusPageResult.success
          ? statusPageResult.statusPage?.headline
          : undefined
      }
      supportUrl={
        statusPageResult.success
          ? statusPageResult.statusPage?.supportUrl
          : undefined
      }
      hideBranding={isStatusPageBrandingHidden()}
      language={
        statusPageResult.success
          ? statusPageResult.statusPage?.language
          : undefined
      }
      isPublicView={false}
    />
  );
}
