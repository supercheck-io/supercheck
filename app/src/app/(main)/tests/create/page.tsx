"use client";

import { useRouter } from "next/navigation";
import { SelectionCard } from "@/components/create/selection-card";
import { types } from "@/components/tests/data";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { Video } from "lucide-react";
import { RecordButton } from "@/components/recorder";
import { useProjectContext } from "@/hooks/use-project-context";

const breadcrumbs = [
  { label: "Home", href: "/" },
  { label: "Tests", href: "/tests" },
  { label: "Create", isCurrentPage: true },
];

const testDescriptions: Record<string, string> = {
  browser:
    "Automate browser interactions and verify user workflows with Playwright.",
  api: "Test REST APIs, validate responses, and verify integrations.",
  database: "Query and test database operations with full schema verification.",
  custom: "Create advanced integration tests combining multiple approaches.",
  performance:
    "Load test with k6, simulate concurrent users, and monitor metrics.",
};

export default function CreateTestPage() {
  const router = useRouter();
  const { currentProject } = useProjectContext();

  const testTypes = types.map((type) => ({
    icon: <type.icon size={32} className={type.color} />,
    title: type.label,
    description: testDescriptions[type.value],
    onClick: () => router.push(`/playground?scriptType=${type.value}`),
    value: type.value,
  }));

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <Card className="m-4 shadow-sm hover:shadow-md transition-shadow duration-200">
        <CardContent className="p-6">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold mb-1">Create New Test</h2>
            <p className="text-muted-foreground text-sm">
              Select the type of test you want to create
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {/* Record Browser Test - First Option */}
            <div className="min-h-[180px] group relative cursor-pointer rounded-lg border border-border/60 bg-card p-6 transition-all hover:border-red-500/50 hover:shadow-md">
              <RecordButton
                projectId={currentProject?.id || ""}
                variant="ghost"
                className="absolute inset-0 w-full h-full flex flex-col items-start justify-start p-6 hover:bg-transparent"
              >
                <div className="mb-4">
                  <Video size={32} className="text-red-500" />
                </div>
                <h3 className="text-lg font-semibold mb-2 group-hover:text-red-500 transition-colors">
                  Record Browser Test
                </h3>
                <p className="text-sm text-muted-foreground text-left">
                  Record browser interactions with SuperCheck Recorder and save directly.
                </p>
              </RecordButton>
            </div>

            {testTypes.map((test) => (
              <SelectionCard
                key={test.title}
                icon={test.icon}
                title={test.title}
                description={test.description}
                onClick={test.onClick}
                className="min-h-[180px]"
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
