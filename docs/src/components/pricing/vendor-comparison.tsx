'use client';

import { useId, useMemo, useState } from 'react';
import {
  CAPABILITY_ROWS,
  SUPERCHECK_PLANS,
  COMPETITORS,
  BROWSERSTACK_AUTOMATE_MONTHLY,
  COMPETITOR_AS_OF,
  MIN_SYNTHETIC_INTERVAL_MINUTES,
  VENDORS,
} from '../../lib/pricing-data';
import {
  estimateCosts,
  formatCount,
  formatUsd,
  planCrossoverMinutes,
  type Estimate,
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
const CROSSOVER_MINUTES = planCrossoverMinutes();

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

function LowestBadge() {
  return (
    <span className="ml-2 rounded border border-fd-primary/40 px-1.5 py-0.5 align-middle text-[11px] font-medium text-fd-primary">
      Lowest
    </span>
  );
}

function BrowserStackCell() {
  // BrowserStack's published range for 5 parallel tests, the most it lists.
  const tier = BROWSERSTACK_AUTOMATE_MONTHLY.find((t) => t.parallelTests === 5);
  if (!tier) return null;
  return (
    <>
      <p className="whitespace-nowrap text-lg font-semibold">
        {`$${formatCount(tier.min)}–$${formatCount(tier.max)}`}
        <span className="text-sm font-normal text-fd-muted-foreground">/mo</span>
      </p>
      <p className="mt-1 text-xs font-normal text-fd-muted-foreground">
        5 parallel tests, monthly billing
      </p>
    </>
  );
}

function CostCell({
  estimate,
  isLowest,
  vendorKey,
}: {
  estimate?: Estimate;
  isLowest: boolean;
  vendorKey: string;
}) {
  if (vendorKey === 'browserstack') return <BrowserStackCell />;
  if (!estimate) {
    return (
      <p className="text-sm text-fd-muted-foreground">
        Above the Pro monitor limit. Contact us for an Enterprise quote.
      </p>
    );
  }
  return (
    <>
      <p className="whitespace-nowrap text-lg font-semibold tabular-nums">
        {formatUsd(estimate.monthlyCost)}
        <span className="text-sm font-normal text-fd-muted-foreground">/mo</span>
        {isLowest && <LowestBadge />}
      </p>
      <p className="mt-1 text-xs font-normal text-fd-muted-foreground">
        {estimate.name}: {estimate.detail}
      </p>
    </>
  );
}

export function VendorComparison() {
  const [workload, setWorkload] = useState<Workload>(DEFAULT_WORKLOAD);
  const intervalId = useId();
  const update = (patch: Partial<Workload>) =>
    setWorkload((current) => ({ ...current, ...patch }));

  const result = useMemo(() => estimateCosts(workload), [workload]);
  const cheapest = result.estimates[0];
  const supercheck = result.estimates.find((e) => e.isSupercheck);
  const estimateFor = (key: string) => result.estimates.find((e) => e.id === key);
  // No badge when Supercheck is unpriced (Enterprise) or the top two are within
  // the "about the same" margin the summary uses.
  const runnerUp = result.estimates[1];
  const lowestId =
    supercheck && (!runnerUp || runnerUp.monthlyCost - cheapest.monthlyCost >= 0.5)
      ? cheapest.id
      : undefined;

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

  // Vendors in cost order for the mobile cards, Supercheck's plan kept even
  // when the workload needs Enterprise (it has no estimate then).
  const cardOrder = [...VENDORS].sort((a, b) => {
    const ca = estimateFor(a.key)?.monthlyCost ?? Number.POSITIVE_INFINITY;
    const cb = estimateFor(b.key)?.monthlyCost ?? Number.POSITIVE_INFINITY;
    return ca - cb;
  });

  return (
    <section aria-labelledby="comparison-heading" className="mt-24">
      <div className="mx-auto mb-8 max-w-2xl text-center">
        <h2 id="comparison-heading" className="mb-3 text-2xl font-semibold tracking-tight">
          Compare Supercheck with Checkly, Datadog, Better Stack and BrowserStack
        </h2>
        <p className="text-fd-muted-foreground">
          Describe your browser checks to estimate the monthly cost, then compare what each
          vendor includes: load testing, status pages, AI investigation, and self-hosting.*
        </p>
      </div>

      <div className="mb-6 rounded-xl border border-fd-border bg-fd-card p-6">
        <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Example workloads">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setWorkload(preset.workload)}
              className="rounded-md border border-fd-border px-3 py-1 text-xs font-medium transition-colors hover:bg-fd-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="grid gap-6 md:grid-cols-3">
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
          minutes per month, run once from Europe. Retries are not included.
        </p>
      </div>

      <p role="status" aria-atomic="true" className="mb-4 text-center text-sm font-medium">
        {summary}
      </p>
      {result.notices.map((notice) => (
        <p key={notice} className="mb-4 text-center text-sm text-fd-muted-foreground">
          {notice}
        </p>
      ))}

      {/* Desktop: one table, vendors as columns */}
      <div
        className="relative hidden overflow-x-auto rounded-lg border lg:block"
        role="region"
        aria-label="Cost and capability comparison by vendor"
        tabIndex={0}
      >
        <table className="w-full min-w-[960px] table-fixed">
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[17.2%]" />
            <col className="w-[17.2%]" />
            <col className="w-[17.2%]" />
            <col className="w-[17.2%]" />
            <col className="w-[17.2%]" />
          </colgroup>
          <caption className="sr-only">
            Estimated monthly cost for your browser workload, and what each vendor includes
          </caption>
          <thead className="bg-fd-muted">
            <tr>
              <th scope="col" className="px-3 py-3 text-left text-sm font-medium">
                <span className="sr-only">Feature</span>
              </th>
              {VENDORS.map((vendor) => {
                const competitor = COMPETITORS.find((c) => c.id === vendor.key);
                return (
                  <th
                    key={vendor.key}
                    scope="col"
                    className={`px-3 py-3 text-left text-sm font-medium ${vendor.key === 'supercheck' ? 'bg-fd-primary/10 text-fd-primary' : ''}`}
                  >
                    {competitor ? (
                      <a
                        href={competitor.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline-offset-2 hover:underline"
                      >
                        {vendor.name}
                        <span className="sr-only"> pricing page (opens in a new tab)</span>
                      </a>
                    ) : (
                      vendor.name
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-fd-card align-top">
              <th scope="row" className="px-3 py-4 text-left text-sm font-medium">
                Browser tests
                <span className="block text-xs font-normal text-fd-muted-foreground">
                  Your workload, estimated per month
                </span>
              </th>
              {VENDORS.map((vendor) => (
                <td
                  key={vendor.key}
                  className={`px-3 py-4 ${vendor.key === 'supercheck' ? 'bg-fd-primary/5' : ''}`}
                >
                  <CostCell
                    estimate={estimateFor(vendor.key)}
                    isLowest={lowestId === vendor.key}
                    vendorKey={vendor.key}
                  />
                </td>
              ))}
            </tr>
            {CAPABILITY_ROWS.map((row, idx) => (
              <tr key={row.name} className={idx % 2 === 0 ? 'bg-fd-muted/30' : 'bg-fd-card'}>
                <th scope="row" className="px-3 py-3 text-left text-sm font-normal">
                  {row.name}
                </th>
                {VENDORS.map((vendor) => (
                  <td
                    key={vendor.key}
                    className={`px-3 py-3 text-sm ${vendor.key === 'supercheck' ? 'bg-fd-primary/5 font-medium' : 'text-fd-muted-foreground'}`}
                  >
                    {row[vendor.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: one card per vendor, cheapest first */}
      <ol className="space-y-4 lg:hidden" aria-label="Cost and capability comparison by vendor">
        {cardOrder.map((vendor) => (
          <li
            key={vendor.key}
            className={`rounded-xl border p-5 ${vendor.key === 'supercheck' ? 'border-fd-primary bg-fd-primary/5' : 'border-fd-border bg-fd-card'}`}
          >
            <h3 className="mb-2 text-base font-semibold">{vendor.name}</h3>
            <CostCell
              estimate={estimateFor(vendor.key)}
              isLowest={lowestId === vendor.key}
              vendorKey={vendor.key}
            />
            <dl className="mt-4 space-y-3 border-t border-fd-border pt-4 text-sm">
              {CAPABILITY_ROWS.map((row) => (
                <div key={row.name}>
                  <dt className="text-xs text-fd-muted-foreground">{row.name}</dt>
                  <dd className={vendor.key === 'supercheck' ? 'font-medium' : ''}>
                    {row[vendor.key]}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>

      <p className="mt-4 border-t border-fd-border pt-4 text-center text-xs text-fd-muted-foreground">
        Browser test costs compare execution only. BrowserStack bills per parallel test. Its range is for 5
        parallel tests on monthly billing (it lists no price above 5) and is shown for reference, not
        ranked. Supercheck includes {SUPERCHECK_PLANS.map((plan) => `${plan.runningCapacity} concurrent runs on ${plan.name}`).join(' and ')}. Checkly and Datadog prices are annual-billing rates; Supercheck
        prices are monthly. Supercheck plans also include monitors, status
        pages, team seats, and AI SRE. Other vendors may price those separately, so check each
        vendor.
      </p>

      <details className="mx-auto mt-6 max-w-3xl text-xs text-fd-muted-foreground">
        <summary className="cursor-pointer font-medium text-fd-foreground">
          How we calculated this
        </summary>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            Runs per month = checks × runs per day, over a 30-day month, from one location.
            Browser checks run only in Europe, and we price every vendor for the same
            single-location workload. HTTP, SSL, ping and port monitoring from Europe, North
            America and Asia Pacific does not use browser minutes. If browser checks are enabled in more
            locations later, each location counts as a separate run.
          </li>
          <li>
            Supercheck uses the lowest-cost of {SUPERCHECK_PLANS.map(plan => `${plan.name} (${formatUsd(plan.monthlyFee)}, up to ${formatCount(plan.maxMonitors)} monitors)`).join(" and ")} that fits your checks, plus overage after the included minutes.
            For workloads that fit Plus ({formatCount(SUPERCHECK_PLANS[0].maxMonitors)} monitors or fewer), Pro costs less than Plus above
            about {formatCount(CROSSOVER_MINUTES)} browser minutes a month. Browser checks share the monitor limit with HTTP, ping, and port
            monitors.
          </li>
          <li>
            Not priced here: Resolve AI sells AI agents for production operations and does not
            publish prices.
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
        {COMPETITOR_AS_OF} and may change. &quot;Not listed&quot; means the page names no such
        product. Verify with the vendor before deciding. All trademarks belong to their owners.
      </p>
    </section>
  );
}
