import { getSreServices } from "@/actions/sre-services";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { ServiceCatalog } from "@/components/sre/services/service-catalog";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const result = await getSreServices();
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Services", isCurrentPage: true },
  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
        <CardContent>
          <ServiceCatalog
            initialServices={result.services}
            loadError={result.success ? null : result.error}
          />
        </CardContent>
      </Card>
    </div>
  );
}
