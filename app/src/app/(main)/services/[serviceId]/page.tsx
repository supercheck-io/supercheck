import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { ServiceDetailPageClient } from "@/components/sre/services/service-detail-page-client";
import { Card, CardContent } from "@/components/ui/card";

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const { serviceId } = await params;
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Services", href: "/services" },
    { label: "Service", isCurrentPage: true },
  ];

  return (
    // On desktop the page fits the window (no page scrollbar); each column scrolls on its own.
    <div data-fit-viewport className="flex min-h-0 flex-1 flex-col lg:min-h-[560px] lg:overflow-hidden">
      <div className="sr-only">
        <PageBreadcrumbs items={breadcrumbs} />
      </div>
      <Card className="m-4 flex min-h-0 min-w-0 flex-1 flex-col shadow-sm">
        <CardContent className="flex min-h-0 flex-1 flex-col p-4 lg:p-6">
          <ServiceDetailPageClient serviceId={serviceId} />
        </CardContent>
      </Card>
    </div>
  );
}
