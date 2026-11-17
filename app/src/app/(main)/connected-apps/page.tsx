import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { ConnectedApps } from "@/components/connected-apps/connected-apps";
import { PageHeader } from "@/components/shared/page-header";
import { NAV } from "@/lib/nav-areas";

export const dynamic = "force-dynamic";

export default function ConnectedAppsPage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Connected apps", isCurrentPage: true },
  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="m-4 shadow-sm">
        <CardContent className="space-y-4 p-6">
          <PageHeader
            title="Connected apps"
            description="AI agents and other apps you have allowed to read a project over MCP. Disconnecting cuts off an app immediately."
            icon={NAV.connectedApps.icon}
            tone={NAV.connectedApps.tone}
          />
          <ConnectedApps variant="page" />
        </CardContent>
      </Card>
    </div>
  );
}
