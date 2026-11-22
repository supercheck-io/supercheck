import Link from "next/link";
import { PublicStatusPage } from "@/components/status-pages/public-status-page";
import { getStatusPage } from "@/actions/get-status-page";
import { getComponents } from "@/actions/get-components";
import { getIncidents } from "@/actions/get-incidents";
import { isStatusPageBrandingHidden } from "@/lib/feature-flags";
import { withDailyMetrics } from "@/lib/status-page-daily-metrics";

type PublicStatusPagePageProps = {
  params: Promise<{
    id: string;
  }>;
};

// Shown inside the preview frame, so no redirect into the app (an expired session would load the whole app there).
function PreviewUnavailable() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="font-medium">This preview is unavailable.</p>
      <p className="text-sm text-muted-foreground">
        Your session may have ended.{" "}
        <Link href="/status-pages" target="_top" className="underline underline-offset-4">
          Open Status Pages
        </Link>
      </p>
    </div>
  );
}

export default async function PublicStatusPagePage({
  params,
}: PublicStatusPagePageProps) {
  const resolvedParams = await params;
  const result = await getStatusPage(resolvedParams.id);
  if (!result.success || !result.statusPage) return <PreviewUnavailable />;

  const componentsResult = await getComponents(resolvedParams.id);
  const incidentsResult = await getIncidents(resolvedParams.id);
  // A failed read would otherwise render as an empty, all-operational page.
  if (!componentsResult.success || !incidentsResult.success) return <PreviewUnavailable />;
  // getComponents has already checked status_page:view; the preview needs the same uptime bars as the public page.
  const components = await withDailyMetrics(componentsResult.components).catch(
    (error) => {
      console.error("Error loading status page preview uptime:", error);
      // Without check data every component is drawn as manual; flag the monitored ones as having no data instead.
      return componentsResult.components.map((component) => ({
        ...component,
        monitored: (component.monitorIds?.length ?? 0) > 0,
        dailyMetrics: [],
      }));
    },
  );

  return (
    <PublicStatusPage
      statusPage={result.statusPage}
      components={components}
      incidents={incidentsResult.incidents}
      readAt={new Date().toISOString()}
      idOrSubdomain={resolvedParams.id}
      hideBranding={isStatusPageBrandingHidden()}
      isPublicView={false}
    />
  );
}
