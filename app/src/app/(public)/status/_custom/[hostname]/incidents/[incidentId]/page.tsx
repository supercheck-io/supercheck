import { getPublicIncidentDetail } from "@/actions/get-public-incident-detail";
import { getPublicStatusPageByCustomDomain } from "@/actions/get-public-status-page-by-custom-domain";
import { PublicIncidentDetail } from "@/components/status-pages/public-incident-detail";
import { notFound } from "next/navigation";
import { Metadata } from "next";

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
 * /status/_custom/<hostname>/incidents/<incidentId>
 */
export async function generateMetadata({
    params,
}: CustomDomainIncidentDetailPageProps): Promise<Metadata> {
    const resolvedParams = await params;
    const hostname = decodeURIComponent(resolvedParams.hostname);

    const statusPageResult = await getPublicStatusPageByCustomDomain(hostname);

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

    const statusPageResult = await getPublicStatusPageByCustomDomain(hostname);

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

    return (
        <PublicIncidentDetail
            incident={result.incident}
            idOrSubdomain={hostname}
            faviconLogo={statusPage.faviconLogo}
            transactionalLogo={statusPage.transactionalLogo}
            statusPageHeadline={statusPage.headline}
            isPublicView
            isCustomDomain
        />
    );
}
