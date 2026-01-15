"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPageDetail } from "@/components/status-pages/status-page-detail";
import { useStatusPageDetail } from "@/hooks/use-status-pages";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft } from "lucide-react";

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
  const hasData = statusPage !== undefined && statusPage !== null;

  // Handle error - redirect to list page
  useEffect(() => {
    if (error) {
      toast.error("Status page not found", {
        description: "The status page you're looking for doesn't exist or has been deleted."
      });
      router.push("/status-pages");
    }
  }, [error, router]);

  // Show loading state only when no cached data exists
  if (!isMounted || (!hasData && isLoading)) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <SuperCheckLoading size="lg" message="Loading status page..." />
      </div>
    );
  }

  // Handle case where page doesn't exist after loading completed
  // Note: If error is set, useEffect above handles the redirect, so we show loading
  if (!statusPage) {
    // If there was an error, useEffect will redirect, show loading during redirect
    if (error) {
      return (
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
          <SuperCheckLoading size="lg" message="Redirecting..." />
        </div>
      );
    }
    // If no error and no data, show not found (edge case - shouldn't normally happen)
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="py-8 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Status page not found</h2>
            <p className="text-sm text-muted-foreground mb-6">
              The status page you&apos;re looking for doesn&apos;t exist or may have been deleted.
            </p>
            <Button onClick={() => router.push("/status-pages")} variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Status Pages
            </Button>
          </CardContent>
        </Card>
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
