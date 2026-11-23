import { getIncidentDetail } from "@/actions/get-incident-detail";
import { getStatusPage } from "@/actions/get-status-page";
import { PublicIncidentDetail } from "@/components/status-pages/public-incident-detail";
import { isStatusPageBrandingHidden } from "@/lib/feature-flags";
import { redirect } from "next/navigation";
import { pickPublicIncident, toPublicUpdate } from "@/lib/status-pages/public-incident-dto";

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
      // The same public fields as the public page: the full row would put internal columns in the RSC payload.
      incident={{
        ...pickPublicIncident(result.incident),
        updates: result.incident.updates.map(toPublicUpdate),
        statusPage: result.incident.statusPage,
      }}
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
      timeZone={
        statusPageResult.success
          ? statusPageResult.statusPage?.timezone
          : undefined
      }
      isPublicView={false}
    />
  );
}
