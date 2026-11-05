/** @jest-environment node */
const policy = jest.fn();
jest.mock("@/lib/sre/notification-policy", () => ({ getNotificationPolicy: (...a: unknown[]) => policy(...a) }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ error: jest.fn() }) }));
const validate = jest.fn();
jest.mock("@/lib/ai/ai-provider", () => ({ validateAIConfiguration: () => validate() }));
const assertCanStart = jest.fn();
jest.mock("@/lib/sre/investigation-billing", () => ({ assertCanStartSreInvestigation: (...a: unknown[]) => assertCanStart(...a) }));
const dailyLimit = jest.fn();
jest.mock("@/lib/sre/sre-daily-token-limit", () => ({ sreDailyTokenLimitResponse: (...a: unknown[]) => dailyLimit(...a) }));
const sreEnabled = jest.fn();
jest.mock("@/sre/lib/feature-gates", () => ({ isSreEnabled: () => sreEnabled() }));
const start = jest.fn();
const complete = jest.fn();
jest.mock("@/sre/lib/investigation-runner", () => ({
  startSreIncidentInvestigation: (...a: unknown[]) => start(...a),
  completeSreIncidentInvestigation: (...a: unknown[]) => complete(...a),
}));
const triage = jest.fn();
jest.mock("@/sre/lib/triage-runner", () => ({ runSreIncidentTriage: (...a: unknown[]) => triage(...a) }));
let incidentRows: unknown[] = [];
let runRows: unknown[] = [];
// Runs visible to the re-check before starting, i.e. ones that appeared after the decision.
let lateRunRows: unknown[] | null = null;
let orgRunning = 0;
let inTransaction = false;
const lockExecute = jest.fn().mockResolvedValue(undefined);
// Queries are told apart by the columns they select: the incident, the org's running count, else the incident's runs.
const chain = (rows: unknown[]) => {
  const n: Record<string, unknown> = {};
  for (const k of ["from", "where"]) n[k] = () => n;
  n.limit = () => Promise.resolve(rows);
  // The run query is awaited without .limit().
  n.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return n;
};
const recoverStale = jest.fn().mockResolvedValue(undefined);
jest.mock("@/sre/lib/stale-run-recovery", () => ({
  STALE_RUN_AFTER_MS: 300_000,
  failStaleSreInvestigationRunsForIncident: (...a: unknown[]) => recoverStale(...a),
}));
const tx = {
  execute: (...a: unknown[]) => lockExecute(...a),
  select: (cols: Record<string, unknown>) => chain("severity" in cols ? incidentRows : "running" in cols ? [{ running: orgRunning }] : runRows),
};
jest.mock("@/utils/db", () => ({
  db: {
    // Outside the transaction (the re-check before starting) only the run query is issued.
    select: (cols: Record<string, unknown>) => chain("running" in cols ? [{ running: orgRunning }] : lateRunRows ?? runRows),
    transaction: async (callback: (t: typeof tx) => unknown) => {
      inTransaction = true;
      try {
        return await callback(tx);
      } finally {
        inTransaction = false;
      }
    },
  },
}));

import { maybeAutoInvestigateOnOpen } from "./auto-investigate";

const input = { organizationId: "org-1", projectId: "p1", incidentId: "i1", userId: null };

beforeEach(() => {
  jest.clearAllMocks();
  runRows = [];
  orgRunning = 0;
  lateRunRows = null;
  sreEnabled.mockReturnValue(true);
  policy.mockResolvedValue({ autoInvestigateOnOpen: true });
  incidentRows = [{ severity: "sev1", status: "triggered" }];
  validate.mockReturnValue(undefined);
  dailyLimit.mockResolvedValue(null);
  assertCanStart.mockResolvedValue(undefined);
  start.mockResolvedValue({ success: true, investigationRunId: "run-1", incident: { id: "i1" } });
  complete.mockResolvedValue({ success: true });
  triage.mockResolvedValue({ success: true });
});

it("does nothing unless the project switched it on", async () => {
  policy.mockResolvedValue({ autoInvestigateOnOpen: false });
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: false, reason: "disabled" });
  expect(start).not.toHaveBeenCalled();
  expect(triage).not.toHaveBeenCalled();
});

it.each(["sev1", "sev2"])("starts a full investigation for %s through the billing and daily-limit gates", async (severity) => {
  incidentRows = [{ severity, status: "triggered" }];
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: true });
  expect(assertCanStart).toHaveBeenCalledWith("org-1");
  expect(dailyLimit).toHaveBeenCalledWith("org-1");
  expect(start).toHaveBeenCalledWith(expect.objectContaining({ incidentId: "i1", enableLiveConnectors: false }));
  // The run is settled in the background with the started run and incident.
  expect(complete).toHaveBeenCalledWith("run-1", { id: "i1" }, expect.objectContaining({ incidentId: "i1", enableLiveConnectors: false }));
  expect(triage).not.toHaveBeenCalled();
});

it.each(["sev3", "sev4"])("runs only a triage for %s", async (severity) => {
  incidentRows = [{ severity, status: "triggered" }];
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: true });
  expect(triage).toHaveBeenCalledWith(input);
  expect(start).not.toHaveBeenCalled();
});

it("takes a per-incident advisory lock and releases it before the run starts", async () => {
  const { PgDialect } = jest.requireActual("drizzle-orm/pg-core");
  let startedInsideTransaction: boolean | undefined;
  start.mockImplementationOnce(async () => {
    startedInsideTransaction = inTransaction;
    return { success: true, investigationRunId: "run-1", incident: { id: "i1" } };
  });
  await maybeAutoInvestigateOnOpen(input);
  expect(lockExecute).toHaveBeenCalledTimes(1);
  const lock = new PgDialect().sqlToQuery(lockExecute.mock.calls[0][0]);
  expect(lock.sql).toContain("pg_advisory_xact_lock");
  expect(lock.params).toEqual(["auto-investigate:i1"]);
  expect(startedInsideTransaction).toBe(false);
});

it("runs triage outside the transaction too", async () => {
  incidentRows = [{ severity: "sev3", status: "triggered" }];
  let inside: boolean | undefined;
  triage.mockImplementationOnce(async () => {
    inside = inTransaction;
    return { success: true };
  });
  await maybeAutoInvestigateOnOpen(input);
  expect(inside).toBe(false);
});

it("treats a lost race on the active-run index as already running", async () => {
  start.mockResolvedValue({ success: false, status: 409, error: "running" });
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: false, reason: "already_running" });
  incidentRows = [{ severity: "sev4", status: "triggered" }];
  triage.mockResolvedValue({ success: false, status: 409, error: "running" });
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: false, reason: "already_running" });
});

it("re-reads the incident after the lock, so one resolved while waiting is not investigated", async () => {
  incidentRows = [{ severity: "sev1", status: "resolved", createdAt: new Date() }];
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: false, reason: "not_open" });
  expect(start).not.toHaveBeenCalled();
});

it("skips incidents opened before auto-investigate was switched on", async () => {
  policy.mockResolvedValue({ autoInvestigateOnOpen: true, autoInvestigateEnabledAt: new Date("2026-06-02T00:00:00Z") });
  incidentRows = [{ severity: "sev1", status: "triggered", createdAt: new Date("2026-06-01T00:00:00Z") }];
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: false, reason: "predates_policy" });
  expect(start).not.toHaveBeenCalled();
});

it("does not start a second automatic run for an incident that already has one", async () => {
  runRows = [{ status: "failed" }, { status: "completed" }];
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: false, reason: "already_investigated" });
  expect(start).not.toHaveBeenCalled();
  expect(triage).not.toHaveBeenCalled();
});

it("re-checks just before starting, so a run another trigger completed meanwhile is not repeated", async () => {
  lateRunRows = [{ status: "completed" }];
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: false, reason: "already_investigated" });
  expect(start).not.toHaveBeenCalled();
});

it("retries after failed runs, but stops after three failed automatic attempts", async () => {
  runRows = [{ status: "failed" }, { status: "timed_out" }];
  await maybeAutoInvestigateOnOpen(input);
  expect(start).toHaveBeenCalledTimes(1);

  jest.clearAllMocks();
  runRows = [{ status: "failed" }, { status: "aborted" }, { status: "failed" }];
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: false, reason: "retry_limit" });
  expect(start).not.toHaveBeenCalled();
});

it("applies the daily token limit to triage as well", async () => {
  incidentRows = [{ severity: "sev4", status: "triggered" }];
  dailyLimit.mockResolvedValue({});
  expect(await maybeAutoInvestigateOnOpen(input)).toMatchObject({ handled: false, reason: "daily_limit" });
  expect(triage).not.toHaveBeenCalled();
});

it("starts nothing when billing, the daily limit, the AI config or the incident state refuse", async () => {
  const call = () => maybeAutoInvestigateOnOpen(input);
  assertCanStart.mockRejectedValue(new Error("no plan"));
  expect(await call()).toMatchObject({ handled: false, reason: "billing" });
  assertCanStart.mockResolvedValue(undefined);
  dailyLimit.mockResolvedValue({});
  expect(await call()).toMatchObject({ handled: false, reason: "daily_limit" });
  dailyLimit.mockResolvedValue(null);
  validate.mockImplementation(() => { throw new Error("no key"); });
  expect(await call()).toMatchObject({ handled: false, reason: "ai_not_configured" });
  validate.mockReturnValue(undefined);
  incidentRows = [{ severity: "sev1", status: "resolved" }];
  expect(await call()).toMatchObject({ handled: false, reason: "not_open" });
  expect(start).not.toHaveBeenCalled();
});

it("starts nothing while the organization already has the maximum runs in flight", async () => {
  orgRunning = 3;
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: false, reason: "org_concurrency_limit" });
  expect(start).not.toHaveBeenCalled();
  expect(triage).not.toHaveBeenCalled();
  // A slot freed after the decision is still honoured by the re-check before starting.
  orgRunning = 0;
  lateRunRows = [];
  expect(await maybeAutoInvestigateOnOpen(input)).toEqual({ handled: true });
});

it("recovers stale runs of the incident before looking for a blocking run", async () => {
  await maybeAutoInvestigateOnOpen(input);
  expect(recoverStale).toHaveBeenCalledWith(input);
  expect(recoverStale.mock.invocationCallOrder[0]).toBeLessThan(lockExecute.mock.invocationCallOrder[0]);
});
