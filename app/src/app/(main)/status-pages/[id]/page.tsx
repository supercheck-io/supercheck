"use client";

import { useParams, useRouter } from "next/navigation";
import { useSyncExternalStore, useEffect } from "react";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPageDetail } from "@/components/status-pages/status-page-detail";
import { useStatusPageDetail } from "@/hooks/use-status-pages";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";
import { toast } from "sonner";

export default function StatusPagePage() {
  const params = useParams();
  const router = useRouter();
  const statusPageId = params.id as string;

  // Track mount state to prevent hydration mismatch
  const isMounted = useSyncExternalStore(
    () => () => { },
    () => true,
    () => false
  );

  // Use React Query hook for status page data (cached, handles loading/error)
  const { statusPage, components, monitors, canUpdate, isLoading, error } =
    useStatusPageDetail(statusPageId);

  // Handle error - redirect to list page
  useEffect(() => {
    if (error) {
      toast.error("Status page not found", {
        description: "The status page you're looking for doesn't exist or has been deleted."
      });
      router.push("/status-pages");
    }
  }, [error, router]);

  // Show loading state
  if (!isMounted || isLoading) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <SuperCheckLoading size="lg" message="Loading status page..." />
      </div>
    );
  }

  // Handle case where page doesn't exist
  if (!statusPage) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <SuperCheckLoading size="lg" message="Loading status page..." />
      </div>
    );
  }

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Status Pages", href: "/status-pages" },
    { label: statusPage.name, isCurrentPage: true },
  ];

  // Transform data for StatusPageDetail component
  // Convert undefined values to null to match the component's expected types
  const statusPageForDetail = {
    id: statusPage.id,
    name: statusPage.name,
    subdomain: statusPage.subdomain,
    status: statusPage.status,
    pageDescription: statusPage.pageDescription,
    headline: statusPage.headline,
    supportUrl: statusPage.supportUrl,
    timezone: statusPage.timezone,
    allowPageSubscribers: statusPage.allowPageSubscribers ?? null,
    allowEmailSubscribers: statusPage.allowEmailSubscribers ?? null,
    allowWebhookSubscribers: statusPage.allowWebhookSubscribers ?? null,
    allowIncidentSubscribers: statusPage.allowIncidentSubscribers ?? null,
    allowSlackSubscribers: statusPage.allowSlackSubscribers ?? null,
    allowRssFeed: statusPage.allowRssFeed ?? null,
    notificationsFromEmail: statusPage.notificationsFromEmail ?? null,
    notificationsEmailFooter: statusPage.notificationsEmailFooter ?? null,
    customDomain: statusPage.customDomain,
    customDomainVerified: statusPage.customDomainVerified,
    cssBodyBackgroundColor: statusPage.cssBodyBackgroundColor ?? null,
    cssFontColor: statusPage.cssFontColor ?? null,
    cssGreens: statusPage.cssGreens ?? null,
    cssYellows: statusPage.cssYellows ?? null,
    cssOranges: statusPage.cssOranges ?? null,
    cssBlues: statusPage.cssBlues ?? null,
    cssReds: statusPage.cssReds ?? null,
    faviconLogo: statusPage.faviconLogo,
    transactionalLogo: statusPage.transactionalLogo,
    createdAt: statusPage.createdAt ? new Date(statusPage.createdAt) : null,
    updatedAt: statusPage.updatedAt ? new Date(statusPage.updatedAt) : null,
  };

  const componentsForDetail = components.map((component) => ({
    ...component,
    createdAt: component.createdAt ? new Date(component.createdAt) : null,
    updatedAt: component.updatedAt ? new Date(component.updatedAt) : null,
  }));

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent className="p-0">
          <StatusPageDetail
            statusPage={statusPageForDetail}
            monitors={monitors}
            components={componentsForDetail}
            canUpdate={canUpdate}
          />
        </CardContent>
      </Card>
    </div>
  );
}
