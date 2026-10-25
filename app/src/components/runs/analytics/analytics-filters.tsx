"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const ANALYTICS_PERIODS = [30, 60, 90] as const;

interface AnalyticsFiltersProps {
  jobs: Array<{ id: string; name: string }>;
  selectedJob: string | null;
  onJobChange: (jobId: string) => void;
  period: number;
  onPeriodChange: (period: number) => void;
  /** Extra controls rendered before the selectors (e.g. Compare Runs). */
  children?: React.ReactNode;
}

/** Job + Period selectors shared by the k6 and Playwright analytics views. */
export function AnalyticsFilters({
  jobs,
  selectedJob,
  onJobChange,
  period,
  onPeriodChange,
  children,
}: AnalyticsFiltersProps) {
  if (jobs.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {children}
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted-foreground">Job:</span>
        <Select value={selectedJob ?? ""} onValueChange={onJobChange}>
          <SelectTrigger className="h-9 w-56" aria-label="Job">
            <SelectValue placeholder="Select a job" />
          </SelectTrigger>
          <SelectContent>
            {jobs.map((job) => (
              <SelectItem key={job.id} value={job.id}>
                {job.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted-foreground">Period:</span>
        <Select
          value={period.toString()}
          onValueChange={(v) => onPeriodChange(parseInt(v))}
        >
          <SelectTrigger className="h-9 w-28" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ANALYTICS_PERIODS.map((days) => (
              <SelectItem key={days} value={days.toString()}>
                {days} days
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
