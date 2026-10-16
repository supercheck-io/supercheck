'use client';

import { useId, useMemo, useState } from 'react';
import {
  COMPETITORS,
  COMPETITOR_AS_OF,
  MIN_SYNTHETIC_INTERVAL_MINUTES,
} from '../../lib/pricing-data';
import {
  estimateCosts,
  formatCount,
  formatUsd,
  type Workload,
} from '../../lib/pricing-estimate';

const INTERVALS = [5, 10, 15, 30, 60].filter(
  (minutes) => minutes >= MIN_SYNTHETIC_INTERVAL_MINUTES,
);

const PRESETS: { label: string; workload: Workload }[] = [
  {
    label: 'Small team',
    workload: { checks: 5, intervalMinutes: 15, durationSeconds: 20 },
  },
  {
    label: 'Growing product',
    workload: { checks: 20, intervalMinutes: 10, durationSeconds: 30 },
  },
  {
    label: 'Long user journeys',
    workload: { checks: 20, intervalMinutes: 15, durationSeconds: 90 },
  },
];

const DEFAULT_WORKLOAD = PRESETS[1].workload;

function formatInterval(minutes: number) {
  return minutes === 60 ? 'hour' : `${minutes} minutes`;
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, unit, onChange }: SliderProps) {
  const id = useId();
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <output htmlFor={id} className="text-sm tabular-nums text-fd-muted-foreground">
          {formatCount(value)} {unit}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 w-full cursor-pointer accent-fd-primary"
      />
    </div>
  );
}

export function CostCalculator() {
  const [workload, setWorkload] = useState<Workload>(DEFAULT_WORKLOAD);
  const intervalId = useId();
  const update = (patch: Partial<Workload>) =>
    setWorkload((current) => ({ ...current, ...patch }));

  const result = useMemo(() => estimateCosts(workload), [workload]);
  const highest = Math.max(...result.estimates.map((e) => e.monthlyCost), 1);
  const cheapest = result.estimates[0];
  const supercheck = result.estimates.find((e) => e.isSupercheck);

  let summary: string;
  if (!supercheck) {
    summary = 'This workload needs an Enterprise plan.';
  } else if (cheapest.isSupercheck) {
    const next = result.estimates[1];
    const gap = next.monthlyCost - supercheck.monthlyCost;
    summary =
      gap < 0.5
        ? `${supercheck.name} and ${next.name} cost about the same.`
        : `${supercheck.name} is the lowest estimate, ${formatUsd(gap)} per month below ${next.name}.`;
  } else {
    const gap = supercheck.monthlyCost - cheapest.monthlyCost;
    summary =
      gap < 0.5
        ? `${supercheck.name} and ${cheapest.name} cost about the same.`
        : `${cheapest.name} is the lowest estimate here; ${supercheck.name} costs ${formatUsd(gap)} more per month.`;
  }

  return (
    <section aria-labelledby="calculator-heading" className="mb-20">
      <div className="mx-auto mb-8 max-w-2xl text-center">
        <h2 id="calculator-heading" className="mb-3 text-2xl font-bold">
          Estimate your browser test costs
        </h2>
        <p className="text-fd-muted-foreground">
          Checkly and Datadog bill browser tests per run; Supercheck and Better Stack bill by
          the minute. Describe your checks and compare the monthly cost.*
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="rounded-xl border border-fd-border bg-fd-card p-6 lg:col-span-2">
          <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Example workloads">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setWorkload(preset.workload)}
                className="rounded-full border border-fd-border px-3 py-1 text-xs font-medium transition-colors hover:bg-fd-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="space-y-6">
            <Slider
              label="Browser checks"
              value={workload.checks}
              min={1}
              max={250}
              unit={workload.checks === 1 ? 'check' : 'checks'}
              onChange={(checks) => update({ checks })}
            />
            <div>
              <label htmlFor={intervalId} className="mb-2 block text-sm font-medium">
                Run every
              </label>
              <select
                id={intervalId}
                value={workload.intervalMinutes}
                onChange={(event) => update({ intervalMinutes: Number(event.target.value) })}
                className="w-full rounded-lg border border-fd-border bg-fd-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
              >
                {INTERVALS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatInterval(minutes)}
                  </option>
                ))}
              </select>
            </div>
            <Slider
              label="Average run time"
              value={workload.durationSeconds}
              min={5}
              max={180}
              unit="seconds"
              onChange={(durationSeconds) => update({ durationSeconds })}
            />
          </div>

          <p className="mt-6 text-xs text-fd-muted-foreground">
            {formatCount(result.runsPerMonth)} runs and {formatCount(result.playwrightMinutes)} browser
            minutes per month from one location. Retries are not included.
          </p>
        </div>

        <div className="rounded-xl border border-fd-border bg-fd-card p-6 lg:col-span-3">
          <p className="mb-5 text-sm font-medium">
            {summary}
          </p>
          <ol className="space-y-4">
            {result.estimates.map((estimate) => (
              <li key={estimate.id}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{estimate.name}</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatUsd(estimate.monthlyCost)}
                    <span className="font-normal text-fd-muted-foreground">/mo</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-fd-muted" aria-hidden="true">
                  <div
                    className={`h-full rounded-full ${estimate.isSupercheck ? 'bg-fd-primary' : 'bg-fd-muted-foreground/40'}`}
                    style={{ width: `${Math.max(2, (estimate.monthlyCost / highest) * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-fd-muted-foreground">{estimate.detail}</p>
              </li>
            ))}
          </ol>
          {result.notices.map((notice) => (
            <p key={notice} role="status" className="mt-4 text-sm text-fd-muted-foreground">
              {notice}
            </p>
          ))}
          <p className="mt-6 border-t border-fd-border pt-4 text-xs text-fd-muted-foreground">
            Compares browser test execution only. Checkly and Datadog prices are annual-billing
            rates; Supercheck prices are monthly. Supercheck plans also include monitors, status
            pages, team seats, and AI SRE. Other vendors may price those separately, so check
            each vendor.
          </p>
        </div>
      </div>

      <details className="mx-auto mt-6 max-w-3xl text-xs text-fd-muted-foreground">
        <summary className="cursor-pointer font-medium text-fd-foreground">
          How we calculated this
        </summary>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            Runs per month = checks × runs per day, over a 30-day month, from one location.
            Browser checks run from a single EU location, and we price every vendor for
            the same single-location workload. HTTP, SSL, ping and port checks do not use
            browser minutes. If browser checks are enabled in more
            locations later, each location counts as a separate run.
          </li>
          <li>
            Supercheck uses the lowest-cost of Plus ($49, up to 50 monitors) and Pro ($149, up
            to 200 monitors) that fits your checks, plus overage after the included minutes. Browser
            checks share the monitor limit with HTTP, ping, and port monitors.
          </li>
          {COMPETITORS.map((competitor) => (
            <li key={competitor.id}>
              <a
                href={competitor.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2 hover:text-fd-foreground"
              >
                {competitor.name}
              </a>
              : {competitor.billing} {competitor.note}
            </li>
          ))}
        </ul>
      </details>
      <p className="mx-auto mt-4 max-w-3xl text-center text-xs text-fd-muted-foreground">
        * Competitor prices come from each vendor&apos;s public pricing page as of{' '}
        {COMPETITOR_AS_OF} and may change. Verify with the vendor before deciding. All
        trademarks belong to their owners.
      </p>
    </section>
  );
}
