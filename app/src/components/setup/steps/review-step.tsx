"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react";

import { createComponent } from "@/actions/create-component";
import { findRequirementsForSetup, createRequirement } from "@/actions/requirements";
import { createSreService, getSreServices } from "@/actions/sre-services";
import { createStatusPage } from "@/actions/create-status-page";
import { getProjectNotificationPolicy, saveProjectNotificationPolicy } from "@/actions/notification-policy";
import { getComponents } from "@/actions/get-components";
import { getStatusPages } from "@/actions/get-status-pages";
import { publishStatusPage } from "@/actions/publish-status-page";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TableBadge } from "@/components/ui/table-badge";
import type { SetupStepKey } from "@/lib/setup/persona";
import { CopyValueButton } from "../copy-value-button";
import { buildCreateItems, runAll, retryWithDependents, type CreateItem, type ItemResult, type RunnerDeps } from "../create-runner";
import { fetchJson, type StepProps } from "./step-types";

const STEP_TITLES: Partial<Record<SetupStepKey, string>> = {
  app: "Your app",
  alerts: "Alerts",
  monitors: "Monitors",
  statusPage: "Status page",
  developer: "Terminal setup",
  invite: "Invite your team",
  tests: "Requirements and tests",
  aiSre: "AI SRE",
};

export interface ReviewStepProps extends StepProps {
  skipped: SetupStepKey[];
  recordCreated: (key: string, id: string) => Promise<void>;
  getCreated: () => Record<string, string>;
  /** Mark setup completed (PUT status). */
  complete: () => Promise<boolean>;
  completed: boolean;
  /** Re-claims the setup lock; false when someone took over. */
  heartbeat?: () => Promise<boolean>;
  /** Reports whether items are being created, so the Leave dialog can say so. */
  onActiveChange?: (active: boolean) => void;
  /** Filled with a function that cancels the run and resolves once the in-flight item has settled. */
  stopRef?: MutableRefObject<(() => Promise<void>) | null>;
}

function StatusIcon({ status }: { status: ItemResult["status"] }) {
  const cls = "size-4 shrink-0";
  switch (status) {
    case "running":
      return <Loader2 className={`${cls} animate-spin text-muted-foreground`} aria-hidden="true" />;
    case "done":
    case "adopted":
      return <CheckCircle2 className={`${cls} text-success`} aria-hidden="true" />;
    case "failed":
      return <XCircle className={`${cls} text-failure`} aria-hidden="true" />;
    case "skipped":
      return <MinusCircle className={`${cls} text-muted-foreground`} aria-hidden="true" />;
    default:
      return <Circle className={`${cls} text-muted-foreground`} aria-hidden="true" />;
  }
}

const STATUS_LABEL: Record<ItemResult["status"], string> = {
  pending: "Waiting",
  running: "Creating",
  done: "Created",
  adopted: "Already there",
  skipped: "Skipped",
  failed: "Failed",
};

export function ReviewStep({ response, features, permissions, draft, skipped, readOnly, recordCreated, getCreated, complete, completed, heartbeat, onActiveChange, stopRef }: ReviewStepProps) {
  const items = useMemo(
    () => buildCreateItems(draft, { skipped, features, canUpdateProject: permissions.canUpdateProject, canCreateTests: permissions.canCreateTests, canCreateServices: permissions.canCreateServices, minIntervalMinutes: response.minIntervalMinutes }),
    [draft, skipped, features, permissions.canUpdateProject, permissions.canCreateTests, permissions.canCreateServices, response.minIntervalMinutes],
  );
  const [results, setResults] = useState<Record<string, ItemResult>>({});
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [finishFailed, setFinishFailed] = useState(false);

  const controller = useRef(new AbortController());
  const activeRun = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    // A dev double-mount runs cleanup (abort) first, so start from a fresh controller.
    if (controller.current.signal.aborted) controller.current = new AbortController();
    if (stopRef) {
      stopRef.current = async () => {
        controller.current.abort();
        await activeRun.current.catch(() => undefined);
      };
    }
    return () => {
      controller.current.abort();
      if (stopRef) stopRef.current = null;
    };
  }, [stopRef]);
  const active = running || retrying;
  useEffect(() => onActiveChange?.(active), [active, onActiveChange]);
  useEffect(() => () => onActiveChange?.(false), [onActiveChange]);

  const deps: RunnerDeps = {
    setupProjectId: response.projectId,
    fetchJson,
    heartbeat,
    getComponents: async (statusPageId) => {
      const res = await getComponents(statusPageId);
      return { success: res.success, components: res.success ? res.components.map((c) => ({ id: c.id, name: c.name, monitorIds: c.monitorIds })) : [] };
    },
    getStatusPages: async () => {
      const res = await getStatusPages();
      return { success: res.success, statusPages: res.success ? res.statusPages.map((p) => ({ id: p.id, name: p.name })) : [] };
    },
    createStatusPage: (data) => createStatusPage(data) as ReturnType<RunnerDeps["createStatusPage"]>,
    publishStatusPage: (id) => publishStatusPage(id),
    createComponent: (data) =>
      createComponent({ ...data, status: "operational", showcase: true, onlyShowIfDegraded: false, position: 0, aggregationMethod: "worst_case", failureThreshold: 1 }),
    getPolicy: (projectId) => getProjectNotificationPolicy(projectId),
    savePolicy: (projectId, input) => saveProjectNotificationPolicy(projectId, input as Parameters<typeof saveProjectNotificationPolicy>[1]),
    findRequirements: (query) => findRequirementsForSetup(query, response.projectId),
    createRequirement: (data) => createRequirement(data, response.projectId),
    getServices: async () => {
      const res = await getSreServices();
      return { success: res.success, services: res.services.map((x) => ({ id: x.id, name: x.name })) };
    },
    createService: (data) => createSreService(data as Parameters<typeof createSreService>[0], response.projectId) as ReturnType<RunnerDeps["createService"]>,
    recordCreated,
    getCreated,
  };

  const update = (key: string, result: ItemResult) => setResults((r) => ({ ...r, [key]: { ...r[key], ...result, pingUrl: result.pingUrl ?? r[key]?.pingUrl } }));

  const start = async () => {
    setRunning(true);
    const run = runAll(items, { ...deps, signal: controller.current.signal }, update);
    activeRun.current = run;
    await run;
    setRunning(false);
    setFinished(true);
  };

  const retry = async (item: CreateItem) => {
    // One Retry at a time: two at once would race on the same lookups and ids.
    if (retrying) return;
    setRetrying(true);
    try {
      const run = retryWithDependents(item, items, { ...deps, signal: controller.current.signal }, update, (key) => results[key]?.status === "skipped");
      activeRun.current = run;
      await run;
    } finally {
      setRetrying(false);
    }
  };

  const finish = async () => {
    setFinishFailed(false);
    // "Finished" is shown only once the completed status is saved.
    setFinishFailed(!(await complete().catch(() => false)));
  };

  const savedChannels = draft.alerts?.providerIds?.length ?? 0;
  const savedConnectors = draft.aiSre?.connectorIds?.length ?? 0;
  const savedSecrets = draft.app?.testAccountSecret ? 1 : 0;
  const skippedTitles = skipped.map((key) => STEP_TITLES[key]).filter(Boolean) as string[];
  const failed = items.filter((item) => results[item.key]?.status === "failed");
  const pings = items.filter((item) => results[item.key]?.pingUrl);
  const started = Object.keys(results).length > 0;
  const testsCreated = items.some((item) => item.kind === "requirement" && (results[item.key]?.status === "done" || results[item.key]?.status === "adopted"));
  const skippedAlertsWithChannels = skipped.includes("alerts") && savedChannels > 0 && items.some((item) => item.step === "monitors");

  return (
    <div className="space-y-6" data-testid="setup-review">
      {readOnly ? <Alert variant="info">You have view access. Ask a project admin to create these items.</Alert> : null}

      {savedChannels + savedSecrets + savedConnectors > 0 ? (
        <section aria-labelledby="setup-saved" className="space-y-2">
          <h3 id="setup-saved" className="text-sm font-semibold">
            Already saved
          </h3>
          <p className="text-xs text-muted-foreground">Saved and encrypted when you entered them, using the same actions as the app. Nothing more to do.</p>
          <ul className="space-y-1 text-sm">
            {savedChannels > 0 ? <li>{savedChannels} alert channel{savedChannels === 1 ? "" : "s"}</li> : null}
            {savedConnectors > 0 ? <li>{savedConnectors} AI SRE connector{savedConnectors === 1 ? "" : "s"}</li> : null}
            {savedSecrets > 0 ? <li>Test account secrets</li> : null}
          </ul>
        </section>
      ) : null}

      {skippedAlertsWithChannels ? (
        <Alert variant="info" data-testid="setup-skipped-alerts">
          Monitors will be created without alerts because you skipped Alerts. The channel{savedChannels === 1 ? "" : "s"} you saved stay in the project.
        </Alert>
      ) : null}

      <section aria-labelledby="setup-will-create" className="space-y-2">
        <h3 id="setup-will-create" className="text-sm font-semibold">
          {started ? "Creating" : "Will be created"}
        </h3>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to create, every step was skipped. You can still finish and use the checklist later.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((item, index) => {
              const result = results[item.key] ?? { status: "pending" as const };
              return (
                <li key={item.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5" data-testid={`setup-create-item-${index}`}>
                  <StatusIcon status={result.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{item.label}</p>
                    {item.detail ? <p className="truncate text-xs text-muted-foreground">{item.detail}</p> : null}
                    {result.note ? <p className="text-xs text-muted-foreground">{result.note}</p> : null}
                    {result.error ? <p className="text-xs text-failure">{result.error}</p> : null}
                  </div>
                  <TableBadge tone={result.status === "failed" ? "danger" : result.status === "done" || result.status === "adopted" ? "success" : "neutral"} compact>
                    {STATUS_LABEL[result.status]}
                  </TableBadge>
                  {item.kind === "requirement" && (result.status === "done" || result.status === "adopted") && getCreated()[item.key] ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/playground?scriptType=browser&requirementId=${getCreated()[item.key]}`} aria-label={`Generate test for ${item.label}`}>
                        Generate test
                      </Link>
                    </Button>
                  ) : null}
                  {result.status === "failed" ? (
                    <Button type="button" size="sm" variant="outline" aria-label={`Retry ${item.label}`} disabled={running || retrying || readOnly} onClick={() => retry(item)}>
                      Retry
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {skippedTitles.length > 0 ? <p className="text-xs text-muted-foreground">Skipped: {skippedTitles.join(", ")}. They stay on the checklist.</p> : null}
      </section>

      {testsCreated ? (
        <Alert variant="info" data-testid="setup-jobs-link">
          Run your tests on a schedule or from CI.{" "}
          <Link href="/jobs/create" className="font-medium underline underline-offset-4">
            Create a scheduled job or CI key
          </Link>
        </Alert>
      ) : null}

      {pings.map((item) => (
        <Alert key={item.key} variant="warning" data-testid="setup-ping-url">
          <p className="text-sm font-medium">Ping URL for {item.label}</p>
          <p className="text-xs">Copy it now. It is shown only once; you can reveal it later from the monitor.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all font-mono text-xs">{results[item.key].pingUrl}</code>
            <CopyValueButton value={results[item.key].pingUrl as string} label="Copy ping URL" />
          </div>
        </Alert>
      ))}

      {failed.length > 0 && !running ? <Alert variant="error">{failed.length} item{failed.length === 1 ? "" : "s"} failed. Nothing that succeeded was rolled back. Retry the failed ones or finish and fix them later.</Alert> : null}

      {finishFailed ? <Alert variant="error">Could not save that setup is finished. Check your connection and try again.</Alert> : null}

      {completed && !finishFailed ? (
        <Alert variant="success">
          Setup is finished.{" "}
          <Link href="/" className="font-medium underline underline-offset-4">
            Go to dashboard
          </Link>
        </Alert>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!finished && items.length > 0 ? (
            <Button type="button" disabled={running || readOnly} onClick={start}>
              {running ? "Creating..." : `Create ${items.length} item${items.length === 1 ? "" : "s"}`}
            </Button>
          ) : (
            <Button type="button" disabled={running || readOnly} onClick={finish}>
              Finish setup
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
