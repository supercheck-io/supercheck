import { getSreServices } from "@/actions/sre-services";
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
    <div className="space-y-6 p-4 md:p-6">
      <PageBreadcrumbs items={[
        { label: "Monitor" },
        { label: "Services", isCurrentPage: true },
      ]} />
      <div>
        <h1 className="text-2xl font-semibold">Service catalog</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Find your services, link monitors, and understand dependencies during an incident.
        </p>
      </div>
      <ServiceCatalog
        key={context.project.id}
        initialServices={result.services}
        loadError={result.success ? null : result.error}
        permissions={permissions}
      />
    </div>
  );
}
