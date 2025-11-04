"use client";

import { useRouter } from "next/navigation";
import { SelectionCard } from "@/components/create/selection-card";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { K6Logo } from "@/components/logo/k6-logo";

export function JobCreationCard() {
  const router = useRouter();

  const jobOptions = [
    {
      title: "Playwright Job",
      description:
        "Run Playwright browser automation immediately or configure a recurring schedule.",
      icon: <PlaywrightLogo width={32} height={32} />,
      onClick: () => router.push("/jobs/create/playwright"),
    },
    {
      title: "k6 Performance Job",
      description:
        "Execute k6 performance tests on demand or set them to run automatically.",
      icon: <K6Logo width={32} height={32} />,
      onClick: () => router.push("/jobs/create/k6"),
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-1">Create New Job</h2>
        <p className="text-muted-foreground text-sm">
          Select the job type you want to create
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {jobOptions.map((job) => (
          <SelectionCard
            key={job.title}
            icon={job.icon}
            title={job.title}
            description={job.description}
            onClick={job.onClick}
            className="min-h-[180px]"
          />
        ))}
      </div>
    </div>
  );
}
