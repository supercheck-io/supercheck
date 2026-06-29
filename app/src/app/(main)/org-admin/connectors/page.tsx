import {
  getSreIntegrationBindings,
  getSreIntegrationBindingSetupOptions,
} from "@/actions/sre-integration-bindings";
import { getSreConnectors, getSreConnectorSetupOptions } from "@/actions/sre-connectors";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { ConnectorAdminView } from "@/components/sre/connectors/connector-admin-view";
import { Card, CardContent } from "@/components/ui/card";

export default async function OrgAdminConnectorsPage() {
  const [
    connectorsResult,
    setupOptionsResult,
    bindingsResult,
    bindingSetupOptionsResult,
  ] = await Promise.all([
    getSreConnectors(),
    getSreConnectorSetupOptions(),
    getSreIntegrationBindings(),
    getSreIntegrationBindingSetupOptions(),
  ]);

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Organization Admin", href: "/org-admin" },
    { label: "Connectors", isCurrentPage: true },
  ];

  const loadError = connectorsResult.success
    ? setupOptionsResult.success
      ? bindingsResult.success
        ? bindingSetupOptionsResult.success
          ? null
          : bindingSetupOptionsResult.error
        : bindingsResult.error
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
            initialBindings={bindingsResult.bindings}
            bindingSetupOptions={bindingSetupOptionsResult.options}
            loadError={loadError}
          />
        </CardContent>
      </Card>
    </div>
  );
}
