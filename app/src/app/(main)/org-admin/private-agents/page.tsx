import { getPrivateAgents } from "@/actions/private-agents";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { PrivateAgentsAdminView } from "@/components/sre/private-agents/private-agents-admin-view";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function OrgAdminPrivateAgentsPage() {
  const result = await getPrivateAgents();
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Organization Admin", href: "/org-admin" },
    { label: "Private Agents", isCurrentPage: true },
  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="m-4 shadow-sm transition-shadow duration-200 hover:shadow-md">
        <CardContent>
          <PrivateAgentsAdminView
            initialAgents={result.agents}
            loadError={result.success ? null : result.error}
          />
        </CardContent>
      </Card>
    </div>
  );
}
