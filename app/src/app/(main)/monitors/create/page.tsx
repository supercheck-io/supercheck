import { Metadata } from "next";
import { MonitorCreationWizard } from "@/components/monitors/monitor-creation-wizard";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { monitorTypes } from "@/components/monitors/data";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { MonitorTypesPopover } from "@/components/monitors/monitor-types-popover";

export const metadata: Metadata = {
  title: "Create Monitor | Supercheck",
  description: "Create a new monitor for uptime monitoring",
};

interface CreateMonitorPageProps {
  searchParams: Promise<{ type?: string; fromTest?: string }>;
}

export default async function CreateMonitorPage({ searchParams }: CreateMonitorPageProps) {
  const params = await searchParams;
  const monitorType = params.type;
  const fromTestId = params.fromTest;

  // If fromTest is specified without type, redirect to synthetic_test type
  if (fromTestId && !monitorType) {
    // Automatically use synthetic_test type
    const effectiveType = "synthetic_test";
    const selectedMonitorType = monitorTypes.find(type => type.value === effectiveType);

    if (!selectedMonitorType) {
      notFound();
    }

    const breadcrumbs = [
      { label: "Home", href: "/" },
      { label: "Monitors", href: "/monitors" },
      { label: "Create", href: "/monitors/create" },
      { label: selectedMonitorType.label, isCurrentPage: true },
    ];

    return (
      <div>
        <PageBreadcrumbs items={breadcrumbs} />
        <MonitorCreationWizard />
      </div>
    );
  }

  // If no type specified, show the general create page (existing functionality)
  if (!monitorType) {
    // Redirect to the existing create page with monitor options
    return (

      <div>
        <PageBreadcrumbs items={[
          { label: "Monitors", href: "/monitors" },
          { label: "Create", href: "/monitors/create" },
        ]} />
        <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
          <CardContent>
        <div className="p-2 mt-4">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">Create  Monitor</h1>
            <MonitorTypesPopover />
          </div>
              <p className="text-muted-foreground text-sm mb-6">Select uptime monitor type to get started</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {monitorTypes.map((type) => (
              <Link
                key={type.value}
                href={`/monitors/create?type=${type.value}`}
                className="block p-4 border rounded-lg hover:border-primary transition-colors"
              >
                <div className="flex items-center space-x-3">
                  {type.icon && <type.icon className={`h-6 w-6 ${type.color}`} />}
                  <div>
                    <h3 className="font-medium">{type.label}</h3>
                    <p className="text-sm text-muted-foreground">{type.description}</p>
                  </div>
                </div>
              </Link>
            ))}
            </div>
          </div>
        </CardContent>
      </Card>
      </div>
    );
  }

  // Validate the monitor type
  const selectedMonitorType = monitorTypes.find(type => type.value === monitorType);
  if (!selectedMonitorType) {
    notFound();
  }

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Monitors", href: "/monitors" },
    { label: "Create", href: "/monitors/create" },
    { label: selectedMonitorType.label, isCurrentPage: true },
  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <MonitorCreationWizard />
    </div>
  );
} 