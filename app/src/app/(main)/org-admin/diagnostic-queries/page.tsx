import { getSreDiagnosticQueries, getSreDiagnosticQuerySetupOptions } from "@/actions/sre-diagnostic-queries";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { DiagnosticQueriesAdminView } from "@/components/sre/connectors/diagnostic-queries-admin-view";
import { Card, CardContent } from "@/components/ui/card";

export default async function OrgAdminDiagnosticQueriesPage() {
  const [queriesResult, setupOptionsResult] = await Promise.all([
    getSreDiagnosticQueries(),
    getSreDiagnosticQuerySetupOptions(),
  ]);

  const loadError = queriesResult.success
    ? setupOptionsResult.success
      ? null
      : setupOptionsResult.error
    : queriesResult.error;

  return (
    <div>
      <PageBreadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Organization Admin", href: "/org-admin" },
          { label: "Diagnostic Queries", isCurrentPage: true },
        ]}
      />
      <Card className="m-4 shadow-sm transition-shadow duration-200 hover:shadow-md">
        <CardContent>
          <DiagnosticQueriesAdminView
            initialQueries={queriesResult.queries}
            setupOptions={setupOptionsResult.options}
            loadError={loadError}
          />
        </CardContent>
      </Card>
    </div>
  );
}
