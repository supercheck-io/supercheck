"use client";

import { useCallback, useRef, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { K6AnalyticsTab } from "./k6-analytics-tab";
import { AnalyticsFilters } from "./analytics-filters";

/** k6 performance analytics for the Runs page: filters, Compare Runs, and charts. */
export function K6AnalyticsView() {
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [period, setPeriod] = useState(30);
  const [compareOpen, setCompareOpen] = useState(false);
  const [jobs, setJobs] = useState<Array<{ id: string; name: string }>>([]);
  const jobsLoadedRef = useRef(false);

  // The tab fetches the job list with its first response; auto-select the first job once.
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
      >
        {selectedJob && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2"
            onClick={() => setCompareOpen(true)}
          >
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
            Compare Runs
          </Button>
        )}
      </AnalyticsFilters>
      <K6AnalyticsTab
        selectedJob={selectedJob ?? ""}
        onJobChange={setSelectedJob}
        period={period}
        onPeriodChange={setPeriod}
        isComparingOpen={compareOpen}
        onCompareOpenChange={setCompareOpen}
        onJobsLoaded={handleJobsLoaded}
      />
    </div>
  );
}
