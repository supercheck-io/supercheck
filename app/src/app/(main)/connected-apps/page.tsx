import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectedApps } from "@/components/connected-apps/connected-apps";

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
        <CardHeader>
          <CardTitle>Connected apps</CardTitle>
          <CardDescription>
            AI agents and other apps you have allowed to read a project over MCP. Disconnecting cuts off an app
            immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConnectedApps />
        </CardContent>
      </Card>
    </div>
  );
}
