import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { WelcomePage } from "@/components/setup/welcome-page";

export default function SetupWelcomePage() {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Project setup", href: "/setup" },
    { label: "Welcome", isCurrentPage: true },
  ];
  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="shadow-sm m-4">
        <CardContent>
          <WelcomePage />
        </CardContent>
      </Card>
    </div>
  );
}
