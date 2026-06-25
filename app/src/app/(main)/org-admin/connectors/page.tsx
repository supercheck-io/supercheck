import { getSreConnectors, getSreConnectorSetupOptions } from "@/actions/sre-connectors";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { ConnectorAdminView } from "@/components/sre/connectors/connector-admin-view";
import { Card, CardContent } from "@/components/ui/card";

export default async function OrgAdminConnectorsPage() {
  const [connectorsResult, setupOptionsResult] = await Promise.all([
    getSreConnectors(),
    getSreConnectorSetupOptions(),
  ]);

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Organization Admin", href: "/org-admin" },
    { label: "Connectors", isCurrentPage: true },
  ];

  const loadError = connectorsResult.success
    ? setupOptionsResult.success
      ? null
      : setupOptionsResult.error
    : connectorsResult.error;

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="m-4 shadow-sm transition-shadow duration-200 hover:shadow-md">
        <CardContent>
          <ConnectorAdminView
            initialConnectors={connectorsResult.connectors}
            setupOptions={setupOptionsResult.options}
            loadError={loadError}
          />
        </CardContent>
      </Card>
    </div>
  );
}
