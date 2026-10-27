import { getSreServices } from "@/actions/sre-services";
import { Card, CardContent } from "@/components/ui/card";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { ServiceCatalog } from "@/components/sre/services/service-catalog";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";

export const metadata = { title: "Services | Supercheck" };

export default async function ServicesPage() {
  const context = await requireProjectContext();
  const result = await getSreServices();
  const permissions = {
    canCreate: checkPermissionWithContext("sre_service", "create", context),
    canUpdate: checkPermissionWithContext("sre_service", "update", context),
    canArchive: checkPermissionWithContext("sre_service", "delete", context),
  };

  return (
    <div>
      <PageBreadcrumbs
        items={[
          { label: "Respond", href: "/incidents" },
          { label: "Services", isCurrentPage: true },
        ]}
      />
      <Card className="m-4 min-w-0 overflow-hidden shadow-sm transition-shadow duration-200 hover:shadow-md">
        <CardContent>
          <ServiceCatalog
            key={context.project.id}
            initialServices={result.services}
            loadError={result.success ? null : result.error}
            permissions={permissions}
          />
        </CardContent>
      </Card>
    </div>
  );
}
