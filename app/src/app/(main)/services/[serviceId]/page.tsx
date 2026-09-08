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
    <div className="flex h-[calc(100svh-3.5rem)] min-h-0 flex-col overflow-hidden">
      <div className="sr-only">
        <PageBreadcrumbs items={breadcrumbs} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-4 pb-6">
        <Card className="h-full min-w-0 overflow-hidden shadow-sm">
          <CardContent className="h-full min-w-0 overflow-hidden p-4 md:p-6">
            <ServiceDetailPageClient serviceId={serviceId} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
