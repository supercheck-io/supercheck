import { getPublicIncidentDetail } from "@/actions/get-public-incident-detail";
import { getPublicStatusPage } from "@/actions/get-public-status-page";
import { getPublicStatusPageBySubdomain } from "@/actions/get-public-status-page-by-subdomain";
import { PublicIncidentDetail } from "@/components/status-pages/public-incident-detail";
import { notFound } from "next/navigation";
import { Metadata } from "next";

type PublicIncidentDetailPageProps = {
  params: Promise<{
    id: string;
    incidentId: string;
  }>;
};

/**
 * Status page lookup strategy (same as main status page)
 * 1. Try subdomain lookup first (from middleware rewrites)
 * 2. Fallback to ID lookup (for direct access or backward compatibility)
 */
async function getStatusPageData(idOrSubdomain: string) {
  // Check if this looks like a UUID
  const looksLikeUUID =
    idOrSubdomain.includes("-") ||
    (idOrSubdomain.length === 36 &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        idOrSubdomain
      ));

  // Try subdomain lookup first
  if (!looksLikeUUID) {
    const subdomainResult = await getPublicStatusPageBySubdomain(
      idOrSubdomain
    );
    if (subdomainResult.success && subdomainResult.statusPage) {
      return subdomainResult.statusPage;
    }
  }

  // Fallback to ID lookup
  const idResult = await getPublicStatusPage(idOrSubdomain);
  if (idResult.success && idResult.statusPage) {
    return idResult.statusPage;
  }

  return null;
}

export async function generateMetadata({
  params,
}: PublicIncidentDetailPageProps): Promise<Metadata> {
  const resolvedParams = await params;

  // Get status page to determine the actual ID
  const statusPage = await getStatusPageData(resolvedParams.id);

  if (!statusPage) {
    return {
      title: "Incident Not Found",
    };
  }

  const result = await getPublicIncidentDetail(
    resolvedParams.incidentId,
    statusPage.id // Use the actual status page ID, not the subdomain
  );

  if (!result.success || !result.incident) {
    return {
      title: "Incident Not Found",
    };
  }

  return {
    title: `${result.incident.name} - ${statusPage.name}`,
    description: result.incident.body || undefined,
  };
}

export default async function PublicIncidentDetailPage({
  params,
}: PublicIncidentDetailPageProps) {
  const resolvedParams = await params;

  // Get status page to determine the actual ID
  const statusPage = await getStatusPageData(resolvedParams.id);

  if (!statusPage) {
    notFound();
  }

  const result = await getPublicIncidentDetail(
    resolvedParams.incidentId,
    statusPage.id // Use the actual status page ID, not the subdomain
  );

  if (!result.success || !result.incident) {
    notFound();
  }

  return (
    <PublicIncidentDetail
      incident={result.incident}
      idOrSubdomain={resolvedParams.id}
      faviconLogo={statusPage.faviconLogo}
      transactionalLogo={statusPage.transactionalLogo}
      statusPageHeadline={statusPage.headline}
      isPublicView
    />
  );
}
