import { getPublicIncidentDetail } from "@/actions/get-public-incident-detail";
import { getPublicStatusPageByCustomDomain } from "@/actions/get-public-status-page-by-custom-domain";
import { PublicIncidentDetail } from "@/components/status-pages/public-incident-detail";
import { isStatusPageBrandingHidden } from "@/lib/feature-flags";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import { cache } from "react";
import { headers } from "next/headers";

// Resolve custom-domain incident detail routes at request time so recently
// verified or published pages do not serve stale cached 404s.
export const dynamic = "force-dynamic";

type CustomDomainIncidentDetailPageProps = {
  params: Promise<{
    hostname: string;
    incidentId: string;
  }>;
};

/**
 * Custom domain incident detail route
 *
 * This route handles incident detail pages accessed via custom domains.
 * The proxy.ts middleware rewrites custom domain requests to:
 * /status/custom-domain/<hostname>/incidents/<incidentId>
 */
export async function generateMetadata({
  params,
}: CustomDomainIncidentDetailPageProps): Promise<Metadata> {
  const resolvedParams = await params;
  const hostname = decodeURIComponent(resolvedParams.hostname);

  const statusPageResult = await getStatusPageByCustomDomain(hostname);

  if (!statusPageResult.success || !statusPageResult.statusPage) {
    return {
      title: "Incident Not Found",
    };
  }

  const statusPage = statusPageResult.statusPage;
  const result = await getPublicIncidentDetail(
    resolvedParams.incidentId,
    statusPage.id
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

export default async function CustomDomainIncidentDetailPage({
  params,
}: CustomDomainIncidentDetailPageProps) {
  const resolvedParams = await params;
  const hostname = decodeURIComponent(resolvedParams.hostname);

  const statusPageResult = await getStatusPageByCustomDomain(hostname);

  if (!statusPageResult.success || !statusPageResult.statusPage) {
    notFound();
  }

  const statusPage = statusPageResult.statusPage;
  const result = await getPublicIncidentDetail(
    resolvedParams.incidentId,
    statusPage.id
  );

  if (!result.success || !result.incident) {
    notFound();
  }

  // Detect proxy rewrite vs direct internal route access (see page.tsx sibling)
  const headersList = await headers();
  const requestHost = (headersList.get("x-forwarded-host") || headersList.get("host") || "")
    .replace(/:\d+$/, "")
    .toLowerCase();
  const isProxied = requestHost === hostname.toLowerCase();
  const customDomainRoutePrefix = isProxied
    ? ""
    : `/status/custom-domain/${hostname}`;

  return (
    <PublicIncidentDetail
      incident={result.incident}
      idOrSubdomain={hostname}
      faviconLogo={statusPage.faviconLogo}
      transactionalLogo={statusPage.transactionalLogo}
      statusPageHeadline={statusPage.headline}
      supportUrl={statusPage.supportUrl}
      hideBranding={isStatusPageBrandingHidden()}
      language={result.language}
      isPublicView
      isCustomDomain
      customDomainRoutePrefix={customDomainRoutePrefix}
    />
  );
}

const getStatusPageByCustomDomain = cache(async (hostname: string) =>
  getPublicStatusPageByCustomDomain(hostname)
);
