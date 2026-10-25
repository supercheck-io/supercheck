"use client";

import { useCallback, useRef, useState } from "react";
import { PlaywrightAnalyticsTab } from "./playwright-analytics-tab";
import { AnalyticsFilters } from "./analytics-filters";

/** Playwright job analytics for the Runs page: filters and charts. */
export function PlaywrightAnalyticsView() {
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [period, setPeriod] = useState(30);
  const [jobs, setJobs] = useState<Array<{ id: string; name: string }>>([]);
  const jobsLoadedRef = useRef(false);

  const handleJobsLoaded = useCallback(
    (loaded: Array<{ id: string; name: string }>) => {
      if (jobsLoadedRef.current) return;
      jobsLoadedRef.current = true;
      setJobs(loaded);
      if (loaded.length > 0) setSelectedJob(loaded[0].id);
    },
    []
  );

  return (
    <div className="space-y-4">
      <AnalyticsFilters
        jobs={jobs}
        selectedJob={selectedJob}
        onJobChange={setSelectedJob}
        period={period}
        onPeriodChange={setPeriod}
      />
      <PlaywrightAnalyticsTab
        selectedJob={selectedJob ?? ""}
        onJobChange={setSelectedJob}
        period={period}
        onPeriodChange={setPeriod}
        onJobsLoaded={handleJobsLoaded}
      />
    </div>
  );
}
