"use client";

import { Clock, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { CreateCard } from "@/components/create/create-card";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { K6Logo } from "@/components/logo/k6-logo";

export function JobCreationCard() {
  const router = useRouter();

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-bold">Create New Job</h2>
      <p className="text-muted-foreground">
        Select the test type you want to run in your job
      </p>

      {/* First section: Playwright jobs */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <PlaywrightLogo width={24} height={24} />
          Playwright Jobs
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <CreateCard
            icon={<Clock size={24} />}
            title="Scheduled Job"
            description="Create a job that runs on a schedule"
            onClick={() => router.push("/jobs/create/playwright")}
          />
          <CreateCard
            icon={<Zap size={24} />}
            title="Immediate Job"
            description="Run a job immediately"
            onClick={() => router.push("/jobs/create/playwright")}
          />
        </div>
      </div>

      {/* Second section: K6 performance jobs */}
      <div className="mt-12">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <K6Logo width={24} height={24} />
          k6 Performance Jobs
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <CreateCard
            icon={<Clock size={24} />}
            title="Scheduled Job"
            description="Schedule k6 performance tests to run automatically"
            onClick={() => router.push("/jobs/create/k6")}
          />
          <CreateCard
            icon={<Zap size={24} />}
            title="Immediate Job"
            description="Run k6 performance tests now"
            onClick={() => router.push("/jobs/create/k6")}
          />
        </div>
      </div>
    </div>
  );
}
