import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { WelcomePage } from "@/components/setup/welcome-page";

export default async function SetupWelcomePage({ searchParams }: { searchParams: Promise<{ change?: string }> }) {
  const change = (await searchParams).change === "1";
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Project setup", href: "/setup" },
    { label: "Welcome", isCurrentPage: true },
  ];
  return (
    <div data-fit-fill className="flex flex-1 flex-col">
      <PageBreadcrumbs items={breadcrumbs} />
      <Card data-fit-fill className="shadow-sm m-4 flex-1">
        <CardContent className="p-6">
          <WelcomePage change={change} />
        </CardContent>
      </Card>
    </div>
  );
}
