import { PublicStatusPage } from "@/components/status-pages/public-status-page";
import { getPublicStatusPageByCustomDomain } from "@/actions/get-public-status-page-by-custom-domain";
import { getPublicComponents } from "@/actions/get-public-components";
import { getPublicIncidents } from "@/actions/get-public-incidents";
import { isStatusPageBrandingHidden } from "@/lib/feature-flags";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import { cache } from "react";

// Custom domains become active after users save settings, verify DNS, and
// publish the page. Resolve them at request time instead of caching 404s.
export const dynamic = "force-dynamic";

type CustomDomainStatusPageProps = {
  params: Promise<{
    hostname: string;
  }>;
};

/**
 * Custom domain status page route
 *
 * This route handles status pages accessed via custom domains.
 * The proxy.ts middleware rewrites custom domain requests to:
 * /status/custom-domain/<hostname>
 *
 * SECURITY:
 * - Only returns published pages with verified custom domains
 * - The customDomainVerified flag must be true (set after DNS verification)
 */
export async function generateMetadata({
  params,
}: CustomDomainStatusPageProps): Promise<Metadata> {
  const resolvedParams = await params;
  const hostname = decodeURIComponent(resolvedParams.hostname);

  const result = await getStatusPageByCustomDomain(hostname);

  if (!result.success || !result.statusPage) {
    return {
      title: "Status Page Not Found",
    };
  }

  const statusPage = result.statusPage;

  // Build favicon links with cache-busting
  const cacheBuster = statusPage.updatedAt
    ? new Date(statusPage.updatedAt).getTime()
    : Date.now();

  const icons = statusPage.faviconLogo
    ? {
        icon: [
          {
            url: `${statusPage.faviconLogo}?v=${cacheBuster}`,
            type: "image/png",
          },
        ],
        shortcut: [
          {
            url: `${statusPage.faviconLogo}?v=${cacheBuster}`,
            type: "image/png",
          },
        ],
        apple: [
          {
            url: `${statusPage.faviconLogo}?v=${cacheBuster}`,
            type: "image/png",
          },
        ],
      }
    : undefined;

  return {
    title: statusPage.headline || statusPage.name,
    description: statusPage.pageDescription || undefined,
    icons,
  };
}

export default async function CustomDomainStatusPage({
  params,
}: CustomDomainStatusPageProps) {
  const resolvedParams = await params;
  const hostname = decodeURIComponent(resolvedParams.hostname);

  const result = await getStatusPageByCustomDomain(hostname);

  if (!result.success || !result.statusPage) {
    notFound();
  }

  const statusPage = result.statusPage;

  // Detect whether this request arrived via proxy rewrite (actual custom domain)
  // or via direct access to the internal route on the main app domain.
  // When proxied, root-relative links like /incidents/<id> work because the
  // proxy rewrites them. When accessed directly, links need the full internal
  // route prefix so Next.js can route them without the proxy.
  const headersList = await headers();
  const requestHost = (headersList.get("x-forwarded-host") || headersList.get("host") || "")
    .replace(/:\d+$/, "")
    .toLowerCase();
  const isProxied = requestHost === hostname.toLowerCase();
  const customDomainRoutePrefix = isProxied
    ? ""
    : `/status/custom-domain/${hostname}`;

  // Fetch components and incidents for the status page.
  const componentsResult = await getPublicComponents(statusPage.id);
  const incidentsResult = await getPublicIncidents(statusPage.id);

  return (
    <PublicStatusPage
      statusPage={statusPage}
      components={componentsResult.components}
      incidents={incidentsResult.incidents}
      idOrSubdomain={hostname}
      hideBranding={isStatusPageBrandingHidden()}
      isPublicView
      isCustomDomain
      customDomainRoutePrefix={customDomainRoutePrefix}
    />
  );
}

const getStatusPageByCustomDomain = cache(async (hostname: string) =>
  getPublicStatusPageByCustomDomain(hostname)
);
