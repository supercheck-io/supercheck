"use client";

import { useRouter } from "next/navigation";
import { CreateCard } from "@/components/create/create-card";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { K6Logo } from "@/components/logo/k6-logo";

export function JobCreationCard() {
  const router = useRouter();

  const jobOptions = [
    {
      title: "Playwright Job",
      description:
        "Run Playwright browser automation immediately or configure a recurring schedule.",
      icon: <PlaywrightLogo width={36} height={36} className="text-primary" />,
      onClick: () => router.push("/jobs/create/playwright"),
    },
    {
      title: "k6 Performance Job",
      description:
        "Execute k6 performance tests on demand or set them to run automatically.",
      icon: <K6Logo width={36} height={36} className="text-primary" />,
      onClick: () => router.push("/jobs/create/k6"),
    },
  ];

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-bold">Create New Job</h2>
      <p className="text-muted-foreground">
        Select the test type you want to run in your job
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {jobOptions.map((job) => (
          <CreateCard
            key={job.title}
            icon={job.icon}
            title={job.title}
            description={job.description}
            onClick={job.onClick}
            className="min-h-[200px]"
          />
        ))}
      </div>
    </div>
  );
}
