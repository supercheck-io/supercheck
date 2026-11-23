import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import {
  CreatePageContent,
  type QuickCreateCapabilities,
} from "@/components/create/create-page-content";
import { Card, CardContent } from "@/components/ui/card";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";

export default async function CreatePage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Quick Create", isCurrentPage: true },
  ];
  const context = await requireProjectContext();
  const capabilities: QuickCreateCapabilities = {
    canDeclareIncidents: checkPermissionWithContext("sre_incident", "create", context),
    canScheduleMaintenance: checkPermissionWithContext("monitor", "update", context),
    canCreateProjects: checkPermissionWithContext("project", "create", context),
    canInviteMembers: checkPermissionWithContext("member", "create", context),
    canCreateCliTokens: checkPermissionWithContext("apiKey", "create", context),
    canInvestigateSre: checkPermissionWithContext(
      "sre_investigation",
      "investigate",
      context,
    ),
    canCreateSreServices: checkPermissionWithContext(
      "sre_service",
      "create",
      context,
    ),
    canConfigureSreConnectors: checkPermissionWithContext(
      "sre_connector",
      "configure",
      context,
    ),
  };

  return (
    <div data-fit-fill className="flex flex-1 flex-col">
      <PageBreadcrumbs items={breadcrumbs} />
      <Card data-fit-fill className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4 flex-1">
        <CardContent>
          <CreatePageContent capabilities={capabilities} />
        </CardContent>
      </Card>
    </div>
  );
}
