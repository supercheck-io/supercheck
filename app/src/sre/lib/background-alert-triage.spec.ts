jest.mock("@/lib/ai/ai-provider", () => ({
  validateAIConfiguration: jest.fn(),
}));
import { validateAIConfiguration } from "@/lib/ai/ai-provider";

jest.mock("@/sre/lib/feature-gates", () => ({
  isSreBackgroundAlertTriageEnabled: jest.fn(),
  isSreAutomaticTriageEnabled: jest.fn(),
  isSreAlertCorrelationEnabled: jest.fn(() => false),
}));
jest.mock("@/lib/sre/sre-daily-token-limit", () => ({ sreDailyTokenLimitResponse: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
const mockLogInfo = jest.fn();
const mockLogError = jest.fn();
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ warn: (...a: unknown[]) => mockLogInfo(...a), error: (...a: unknown[]) => mockLogError(...a) }) }));
jest.mock("@/lib/sre/incident-notifier", () => ({ notifyIncidentEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/sre/incident-lifecycle", () => ({
  applySourceRecovery: jest.fn(),
  reopenRecentlyAutoResolved: jest.fn(),
  findOpenIncidentForSource: jest.fn().mockResolvedValue(null),
 recordRepeatAlert: jest.fn().mockResolvedValue(true),
  announceSystemTransition: jest.fn().mockResolvedValue(undefined),
  getDefaultAssigneeId: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/status-page-reconciliation", () => ({ linkStatusPageIncidentsToSreIncident: jest.fn().mockResolvedValue([]) }));
jest.mock("@/sre/lib/triage-runner", () => ({ startSreIncidentTriage: jest.fn(), completeSreIncidentTriage: jest.fn() }));
jest.mock("@/sre/lib/auto-investigate", () => ({ maybeAutoInvestigateOnOpen: jest.fn().mockResolvedValue({ handled: false }) }));

const selectQueue: unknown[][] = [];
const inserts: unknown[] = [];
function chain(result: unknown[]) {
  const node: Record<string, unknown> = {};
  for (const name of ["from", "where", "limit", "leftJoin", "innerJoin", "orderBy", "set", "for"]) {
    node[name] = jest.fn(() => node);
  }
  node.values = jest.fn((value: unknown) => {
    inserts.push(value);
    return node;
  });
  node.returning = jest.fn(() => Promise.resolve([{ id: "new-id", assigneeUserId: null }]));
  node.onConflictDoNothing = jest.fn(() => node);
  node.then = (resolve: (value: unknown[]) => unknown) => resolve(result);
  return node;
}
const tx = {
  execute: jest.fn(),
  select: jest.fn(() => chain(selectQueue.shift() ?? [])),
  insert: jest.fn(() => chain([])),
  update: jest.fn(() => chain([])),
};
jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(() => chain(selectQueue.shift() ?? [])),
    update: jest.fn(() => chain([])),
    insert: jest.fn(() => chain([])),
    transaction: (cb: (t: typeof tx) => unknown) => cb(tx),
  },
}));

import {
  announceSystemTransition,
  applySourceRecovery,
  reopenRecentlyAutoResolved,
} from "@/lib/sre/incident-lifecycle";
import { notifyIncidentEvent } from "@/lib/sre/incident-notifier";
import { linkStatusPageIncidentsToSreIncident } from "@/lib/status-page-reconciliation";
import {
  isSreAutomaticTriageEnabled,
  isSreBackgroundAlertTriageEnabled,
} from "@/sre/lib/feature-gates";
import { completeSreIncidentTriage, startSreIncidentTriage } from "@/sre/lib/triage-runner";
import { db } from "@/utils/db";
import { sreDailyTokenLimitResponse } from "@/lib/sre/sre-daily-token-limit";
import { processSreBackgroundAlertTriageJob, startAutomaticIncidentTriage } from "./background-alert-triage";

const mockIsSreBackgroundAlertTriageEnabled = isSreBackgroundAlertTriageEnabled as jest.Mock;
const mockAutomatic = isSreAutomaticTriageEnabled as jest.Mock;
const mockDb = db as jest.Mocked<typeof db>;
const JOB = { alertHistoryId: "018f0000-0000-7000-8000-000000000001" };

const alertRow = (over: Record<string, unknown> = {}) => ({
  id: JOB.alertHistoryId,
  type: "monitor_failure",
  message: "down",
  status: "sent",
  provider: "p1",
  sentAt: new Date("2026-01-01T00:00:00Z"),
  deliveryMetadata: null,
  target: "t",
  monitorId: "mon-1",
  jobId: null,
  monitorName: "Checkout",
  monitorOrganizationId: "org-1",
  monitorProjectId: "proj-1",
  monitorAlertConfig: null,
  jobName: null,
  jobOrganizationId: null,
  jobProjectId: null,
  jobAlertConfig: null,
  ...over,
});
// mappedService, existingAlertEvent, existingIncident, number row
const freshIncidentQueue = () => selectQueue.push([], [{ id: "ae-1" }], [], [{ nextIncidentNumber: 4 }]);
const insertedIncident = () => inserts.find((v) => (v as { incidentNumber?: number }).incidentNumber !== undefined) as Record<string, unknown> | undefined;

describe("processSreBackgroundAlertTriageJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    selectQueue.length = 0;
    inserts.length = 0;
    (validateAIConfiguration as jest.Mock).mockReset();
    (reopenRecentlyAutoResolved as jest.Mock).mockResolvedValue(null);
    mockIsSreBackgroundAlertTriageEnabled.mockReturnValue(false);
    mockAutomatic.mockReturnValue(false);
  });

  it("skips without database access when background triage is disabled", async () => {
    const result = await processSreBackgroundAlertTriageJob({
      alertHistoryId: "018f0000-0000-7000-8000-000000000001",
    });

    expect(result).toEqual({ success: true, skipped: true, reason: "disabled" });
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("skips invalid jobs without database access", async () => {
    mockIsSreBackgroundAlertTriageEnabled.mockReturnValue(true);

    const result = await processSreBackgroundAlertTriageJob({ alertHistoryId: "not-a-uuid" });

    expect(result).toEqual({ success: true, skipped: true, reason: "invalid_job" });
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  describe("incident pipeline", () => {
    beforeEach(() => mockIsSreBackgroundAlertTriageEnabled.mockReturnValue(true));

    it("opens an incident without AI triage when automation is off (ai_disabled)", async () => {
      selectQueue.push([alertRow()]);
      freshIncidentQueue();
      expect(await processSreBackgroundAlertTriageJob(JOB)).toEqual({ success: true, skipped: true, reason: "ai_disabled" });
      expect(insertedIncident()).toMatchObject({ incidentNumber: 4, severity: "sev2", status: "triggered" });
      expect(notifyIncidentEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "created", incidentId: "new-id" }));
      expect(startSreIncidentTriage).not.toHaveBeenCalled();
    });

    const FAILURE_JOB = {
      sourceFailure: {
        sourceType: "monitor",
        sourceId: "018f0000-0000-7000-8000-0000000000aa",
        type: "monitor_failure",
        message: "down",
        firedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const monitorRow = (alertConfig: unknown) => ({ name: "Checkout", organizationId: "org-1", projectId: "proj-1", alertConfig, status: "up", enabled: true });

    it("opens an incident for a monitor with alerts off and incidents opted in, with one alert counted", async () => {
      selectQueue.push([monitorRow({ enabled: false, incidentEnabled: true })]);
      freshIncidentQueue();
      expect(await processSreBackgroundAlertTriageJob(FAILURE_JOB)).toEqual({ success: true, skipped: true, reason: "ai_disabled" });
      expect(insertedIncident()).toMatchObject({ incidentNumber: 4, status: "triggered", alertCount: 1 });
    });

    it.each([{ status: "paused", enabled: true }, { status: "up", enabled: false }])("ignores a queued failure for a paused or disabled monitor %j", async (state) => {
      selectQueue.push([{ ...monitorRow({ enabled: false, incidentEnabled: true }), ...state }]);
      expect(await processSreBackgroundAlertTriageJob(FAILURE_JOB)).toEqual({ success: true, skipped: true, reason: "alert_not_found" });
      expect(insertedIncident()).toBeUndefined();
    });

    it("ignores a failure signal for a monitor that did not opt in to incidents", async () => {
      selectQueue.push([monitorRow({ enabled: false })]);
      expect(await processSreBackgroundAlertTriageJob(FAILURE_JOB)).toEqual({ success: true, skipped: true, reason: "alert_not_found" });
      expect(insertedIncident()).toBeUndefined();
    });

    it("opens the incident but skips triage when no AI provider is configured", async () => {
      mockAutomatic.mockReturnValue(true);
      (validateAIConfiguration as jest.Mock).mockImplementation(() => { throw new Error("missing key"); });
      selectQueue.push([alertRow()]);
      freshIncidentQueue();
      expect(await processSreBackgroundAlertTriageJob(JOB)).toEqual({ success: true, skipped: true, reason: "ai_not_configured" });
      expect(insertedIncident()).toBeDefined();
      expect(startSreIncidentTriage).not.toHaveBeenCalled();
    });

    it("hands a new incident to the project's automatic investigation and skips the instance-wide triage", async () => {
      const { maybeAutoInvestigateOnOpen } = jest.requireMock("@/sre/lib/auto-investigate");
      maybeAutoInvestigateOnOpen.mockResolvedValueOnce({ handled: true });
      mockAutomatic.mockReturnValue(true);
      selectQueue.push([alertRow()]);
      freshIncidentQueue();
      expect(await processSreBackgroundAlertTriageJob(JOB)).toEqual({ success: true, skipped: true, reason: "auto_investigation" });
      expect(maybeAutoInvestigateOnOpen).toHaveBeenCalledWith(expect.objectContaining({ incidentId: "new-id", userId: null }));
      expect(startSreIncidentTriage).not.toHaveBeenCalled();
    });

    it("runs the project's automatic investigation even when instance-wide triage is off", async () => {
      const { maybeAutoInvestigateOnOpen } = jest.requireMock("@/sre/lib/auto-investigate");
      maybeAutoInvestigateOnOpen.mockResolvedValueOnce({ handled: true });
      mockAutomatic.mockReturnValue(false);
      selectQueue.push([alertRow()]);
      freshIncidentQueue();
      expect(await processSreBackgroundAlertTriageJob(JOB)).toEqual({ success: true, skipped: true, reason: "auto_investigation" });
    });

    it("does not start instance-wide triage for an incident that was already investigated automatically", async () => {
      const { maybeAutoInvestigateOnOpen } = jest.requireMock("@/sre/lib/auto-investigate");
      maybeAutoInvestigateOnOpen.mockResolvedValueOnce({ handled: false, reason: "already_investigated" });
      mockAutomatic.mockReturnValue(true);
      selectQueue.push([alertRow()]);
      freshIncidentQueue();
      expect(await processSreBackgroundAlertTriageJob(JOB)).toEqual({ success: true, skipped: true, reason: "already_triaged" });
      expect(startSreIncidentTriage).not.toHaveBeenCalled();
    });

    it("runs AI triage when automation is on and AI is configured", async () => {
      mockAutomatic.mockReturnValue(true);
      (startSreIncidentTriage as jest.Mock).mockResolvedValue({ success: true, investigationRunId: "run-1" });
      selectQueue.push([alertRow()]);
      freshIncidentQueue();
      (completeSreIncidentTriage as jest.Mock).mockReturnValue(new Promise(() => {})); // the job must not wait for the AI run
      expect(await processSreBackgroundAlertTriageJob(JOB)).toMatchObject({ success: true, skipped: false, investigationRunId: "run-1" });
      expect(completeSreIncidentTriage).toHaveBeenCalledWith(expect.objectContaining({ investigationRunId: "run-1" }), expect.objectContaining({ userId: null, origin: "auto" }));
    });

    it("logs, not throws, when the background triage completion fails", async () => {
      mockAutomatic.mockReturnValue(true);
      (startSreIncidentTriage as jest.Mock).mockResolvedValue({ success: true, investigationRunId: "run-1" });
      (completeSreIncidentTriage as jest.Mock).mockRejectedValue(new Error("boom"));
      selectQueue.push([alertRow()]);
      freshIncidentQueue();
      expect(await processSreBackgroundAlertTriageJob(JOB)).toMatchObject({ success: true, skipped: false });
      await Promise.resolve();
      expect(mockLogError).toHaveBeenCalledWith(expect.objectContaining({ investigationRunId: "run-1" }), expect.stringContaining("failed after it started"));
    });

    it("skips, not fails, when triage is refused for billing (402)", async () => {
      mockAutomatic.mockReturnValue(true);
      (startSreIncidentTriage as jest.Mock).mockResolvedValue({ success: false, status: 402, error: "limit" });
      selectQueue.push([alertRow()]);
      freshIncidentQueue();
      expect(await processSreBackgroundAlertTriageJob(JOB)).toMatchObject({ success: true, skipped: true, reason: "triage_billing" });
    });

    it("fails the job so BullMQ retries on a real start error", async () => {
      mockAutomatic.mockReturnValue(true);
      (startSreIncidentTriage as jest.Mock).mockResolvedValue({ success: false, status: 502, error: "x" });
      selectQueue.push([alertRow()]);
      freshIncidentQueue();
      expect(await processSreBackgroundAlertTriageJob(JOB)).toMatchObject({ success: false });
    });

    it("logs and skips when triage is already running (409)", async () => {
      mockAutomatic.mockReturnValue(true);
      (startSreIncidentTriage as jest.Mock).mockResolvedValue({ success: false, status: 409, error: "running" });
      selectQueue.push([alertRow()]);
      freshIncidentQueue();
      expect(await processSreBackgroundAlertTriageJob(JOB)).toMatchObject({ success: true, skipped: true, reason: "triage_in_progress" });
      expect(mockLogInfo).toHaveBeenCalledWith(expect.objectContaining({ incidentId: expect.any(String) }), expect.stringContaining("already running"));
    });

    it("reports the organization run cap separately so the processor defers instead of dropping triage", async () => {
      mockAutomatic.mockReturnValue(true);
      (startSreIncidentTriage as jest.Mock).mockResolvedValue({
        success: false,
        status: 409,
        error: "limit",
        reason: "org_concurrency_limit",
      });
      selectQueue.push([alertRow()]);
      freshIncidentQueue();
      expect(await processSreBackgroundAlertTriageJob(JOB)).toMatchObject({
        success: true,
        skipped: true,
        reason: "org_concurrency_limit",
      });
    });

    it("skips with incident_disabled and creates nothing when incidentEnabled is false", async () => {
      selectQueue.push([alertRow({ monitorAlertConfig: { incidentEnabled: false } })]);
      expect(await processSreBackgroundAlertTriageJob(JOB)).toEqual({ success: true, skipped: true, reason: "incident_disabled" });
      expect(mockDb.transaction).toBeDefined();
      expect(tx.insert).not.toHaveBeenCalled();
    });

    it("links open status-page incidents for a new monitor incident, not for jobs", async () => {
      selectQueue.push([alertRow()]);
      freshIncidentQueue();
      await processSreBackgroundAlertTriageJob(JOB);
      expect(linkStatusPageIncidentsToSreIncident).toHaveBeenCalledWith(tx, { sreIncidentId: "new-id", organizationId: "org-1", projectId: "proj-1", monitorId: "mon-1" });

      (linkStatusPageIncidentsToSreIncident as jest.Mock).mockClear();
      selectQueue.push([alertRow({ monitorId: null, jobId: "job-1", type: "job_failed", monitorOrganizationId: null, monitorProjectId: null, jobOrganizationId: "org-1", jobProjectId: "proj-1", jobName: "N" })]);
      freshIncidentQueue();
      await processSreBackgroundAlertTriageJob(JOB);
      expect(linkStatusPageIncidentsToSreIncident).not.toHaveBeenCalled();
    });

    it("uses incidentSeverity for new incidents", async () => {
      selectQueue.push([alertRow({ monitorAlertConfig: { incidentSeverity: "sev4" } })]);
      freshIncidentQueue();
      await processSreBackgroundAlertTriageJob(JOB);
      expect(insertedIncident()).toMatchObject({ severity: "sev4" });
    });

    it("reads the job alertConfig for job alerts", async () => {
      selectQueue.push([alertRow({ monitorId: null, jobId: "job-1", type: "job_failed", monitorOrganizationId: null, monitorProjectId: null, monitorName: null, jobName: "Nightly", jobOrganizationId: "org-1", jobProjectId: "proj-1", jobAlertConfig: { incidentSeverity: "sev3" } })]);
      freshIncidentQueue();
      await processSreBackgroundAlertTriageJob(JOB);
      expect(insertedIncident()).toMatchObject({ severity: "sev3" });
    });

    it("opens an incident for a failed-delivery row but not a pending one", async () => {
      selectQueue.push([alertRow({ status: "failed" })]);
      freshIncidentQueue();
      await processSreBackgroundAlertTriageJob(JOB);
      expect(insertedIncident()).toBeDefined();

      inserts.length = 0;
      selectQueue.push([alertRow({ status: "pending" })]);
      expect(await processSreBackgroundAlertTriageJob(JOB)).toEqual({ success: true, skipped: true, reason: "non_sent_alert" });
      expect(insertedIncident()).toBeUndefined();
    });

    it("A11: notes a failed paging-preset delivery on the timeline once, with ids and status only", async () => {
      const failedPage = alertRow({
        status: "failed",
        deliveryMetadata: { version: 1, provider: { id: "p1", type: "webhook", preset: "pagerduty" }, delivery: { status: "failed", sentAt: "x", responseStatus: 503 } },
      });
      selectQueue.push([failedPage]);
      freshIncidentQueue();
      selectQueue.push([]); // no page_failed event yet
      await processSreBackgroundAlertTriageJob(JOB);
      expect(notifyIncidentEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "created", triggerAlertHistoryId: JOB.alertHistoryId, report: expect.any(Object) }));
      const pageFailed = inserts.filter((v) => (v as { eventData?: { kind?: string } }).eventData?.kind === "page_failed");
      expect(pageFailed).toEqual([expect.objectContaining({
        eventType: "notification",
        actorType: "system",
        eventData: { kind: "page_failed", alertHistoryId: JOB.alertHistoryId, providerId: "p1", type: "webhook", preset: "pagerduty", status: 503, terminal: false, fallback: "none" },
      })]);

      // A retried row is triaged again: the event is not written twice.
      inserts.length = 0;
      selectQueue.push([failedPage]);
      freshIncidentQueue();
      selectQueue.push([{ id: "existing-event" }]);
      await processSreBackgroundAlertTriageJob(JOB);
      expect(inserts.filter((v) => (v as { eventData?: { kind?: string } }).eventData?.kind === "page_failed")).toEqual([]);
    });

    it("writes no page_failed event for a delivered row or a custom webhook", async () => {
      for (const row of [
        alertRow({ status: "sent", deliveryMetadata: { version: 1, provider: { id: "p1", preset: "pagerduty" }, delivery: { status: "sent" } } }),
        alertRow({ status: "failed", deliveryMetadata: { version: 1, provider: { id: "p1", preset: "custom" }, delivery: { status: "failed" } } }),
      ]) {
        inserts.length = 0;
        selectQueue.push([row]);
        freshIncidentQueue();
        await processSreBackgroundAlertTriageJob(JOB);
        expect(inserts.filter((v) => (v as { eventData?: { kind?: string } }).eventData?.kind === "page_failed")).toEqual([]);
      }
    });

    it("never opens or resolves an incident for the informational SSL renewed notice", async () => {
      selectQueue.push([alertRow({ type: "ssl_renewed" })]);
      expect(await processSreBackgroundAlertTriageJob(JOB)).toEqual({ success: true, skipped: true, reason: "informational_alert" });
      expect(insertedIncident()).toBeUndefined();
    });

    it("reopens a recently auto-resolved incident instead of creating one", async () => {
      (reopenRecentlyAutoResolved as jest.Mock).mockResolvedValue({ incidentId: "inc-old", assigneeUserId: "u1", alreadyTriaged: true });
      selectQueue.push([alertRow()]);
      selectQueue.push([], [{ id: "ae-1" }], []);
      expect(await processSreBackgroundAlertTriageJob(JOB)).toEqual({ success: true, skipped: true, reason: "already_triaged" });
      expect(insertedIncident()).toBeUndefined();
      expect(announceSystemTransition).toHaveBeenCalledWith("org-1", "proj-1", "inc-old", "reopened", expect.objectContaining({ assigneeUserId: "u1", triggerAlertHistoryId: JOB.alertHistoryId, report: expect.any(Object) }));
      expect(notifyIncidentEvent).not.toHaveBeenCalled();
    });

    it("records a failed page on reopen with the fallback the reopen message used", async () => {
      (reopenRecentlyAutoResolved as jest.Mock).mockResolvedValue({ incidentId: "inc-old", assigneeUserId: "u1", alreadyTriaged: true });
      (announceSystemTransition as jest.Mock).mockImplementationOnce(async (_o, _p, _i, _e, extra: { report?: { fallback?: string } }) => {
        if (extra.report) extra.report.fallback = "policy_channels";
      });
      selectQueue.push([alertRow({ status: "failed", deliveryMetadata: { version: 1, provider: { id: "p1", type: "webhook", preset: "pagerduty" }, delivery: { status: "failed", sentAt: "x", responseStatus: 503 } } })]);
      selectQueue.push([], [{ id: "ae-1" }], [], []);
      await processSreBackgroundAlertTriageJob(JOB);
      const pageFailed = inserts.find((v) => (v as { eventData?: { kind?: string } }).eventData?.kind === "page_failed") as { incidentId: string; eventData: { fallback: string } } | undefined;
      expect(pageFailed).toMatchObject({ incidentId: "inc-old", eventData: { fallback: "policy_channels" } });
    });

    it("does not reopen an auto-resolved incident for a non-recoverable alert type", async () => {
      (reopenRecentlyAutoResolved as jest.Mock).mockResolvedValue({ incidentId: "inc-old", assigneeUserId: "u1", alreadyTriaged: true });
      selectQueue.push([alertRow({ type: "ssl_expiring" })]);
      selectQueue.push([], [{ id: "ae-1" }], []);
      await processSreBackgroundAlertTriageJob(JOB);
      expect(reopenRecentlyAutoResolved).not.toHaveBeenCalled();
    });

    it("refreshes a reused alert event with the latest failure", async () => {
      selectQueue.push([alertRow()]);
      selectQueue.push([{ id: "svc-1" }], [{ id: "ae-1" }], []);
      await processSreBackgroundAlertTriageJob(JOB);
      const sets = (tx.update as jest.Mock).mock.results.flatMap((r) => (r.value.set as jest.Mock).mock.calls.map((c) => c[0]));
      expect(sets).toContainEqual(expect.objectContaining({ status: "firing", serviceId: "svc-1", resolvedAt: null, firedAt: expect.any(Date), description: expect.any(String) }));
    });

    it("resolves open incidents on a recovery alert and announces them", async () => {
      (applySourceRecovery as jest.Mock).mockResolvedValue({
        resolved: [{ id: "inc-1" }],
        recovered: [{ id: "inc-2", assigneeUserId: "u2" }],
      });
      selectQueue.push([alertRow({ type: "monitor_recovery", monitorAlertConfig: { autoResolveIncident: false } })]);
      expect(await processSreBackgroundAlertTriageJob(JOB)).toEqual({ success: true, skipped: true, reason: "recovery_handled" });
      expect(applySourceRecovery).toHaveBeenCalledWith(tx, expect.objectContaining({ sourceType: "monitor", sourceId: "mon-1", autoResolve: false, targetName: "Checkout" }));
      expect(announceSystemTransition).toHaveBeenCalledWith("org-1", "proj-1", "inc-1", "resolved", expect.anything());
      expect(announceSystemTransition).toHaveBeenCalledWith("org-1", "proj-1", "inc-2", "recovered", expect.objectContaining({ assigneeUserId: "u2" }));
      expect(insertedIncident()).toBeUndefined();
    });

    it("handles job_success as a recovery and defaults autoResolve to true", async () => {
      (applySourceRecovery as jest.Mock).mockResolvedValue({ resolved: [], recovered: [] });
      selectQueue.push([alertRow({ monitorId: null, jobId: "job-1", type: "job_success", monitorOrganizationId: null, monitorProjectId: null, monitorName: null, jobName: "Nightly", jobOrganizationId: "org-1", jobProjectId: "proj-1" })]);
      await processSreBackgroundAlertTriageJob(JOB);
      expect(applySourceRecovery).toHaveBeenCalledWith(tx, expect.objectContaining({ sourceType: "job", sourceId: "job-1", autoResolve: true }));
    });
  });
});

describe("startAutomaticIncidentTriage (shared with the recovery sweep)", () => {
  const scope = { organizationId: "org-1", projectId: "proj-1", incidentId: "inc-1" };
  beforeEach(() => {
    jest.clearAllMocks();
    (validateAIConfiguration as jest.Mock).mockReset();
  });

  it("starts nothing when automation is off", async () => {
    mockAutomatic.mockReturnValue(false);
    expect(await startAutomaticIncidentTriage(scope)).toEqual({ skipped: true, reason: "ai_disabled" });
    expect(startSreIncidentTriage).not.toHaveBeenCalled();
  });

  it("starts nothing when the AI provider is not configured", async () => {
    mockAutomatic.mockReturnValue(true);
    (validateAIConfiguration as jest.Mock).mockImplementation(() => {
      throw new Error("no key");
    });
    expect(await startAutomaticIncidentTriage(scope)).toEqual({ skipped: true, reason: "ai_not_configured" });
    expect(startSreIncidentTriage).not.toHaveBeenCalled();
  });

  it("starts nothing past the organization's daily token cap", async () => {
    mockAutomatic.mockReturnValue(true);
    (sreDailyTokenLimitResponse as jest.Mock).mockResolvedValueOnce({ status: 429 });
    expect(await startAutomaticIncidentTriage(scope)).toEqual({ skipped: true, reason: "daily_limit" });
    expect(sreDailyTokenLimitResponse).toHaveBeenCalledWith("org-1");
    expect(startSreIncidentTriage).not.toHaveBeenCalled();
  });

  it("reports an unavailable limiter separately so the job retries instead of dropping triage", async () => {
    mockAutomatic.mockReturnValue(true);
    (sreDailyTokenLimitResponse as jest.Mock).mockResolvedValueOnce({ status: 503 });
    expect(await startAutomaticIncidentTriage(scope)).toEqual({ skipped: true, reason: "daily_limit_unavailable" });
    expect(startSreIncidentTriage).not.toHaveBeenCalled();
  });

  it("maps billing refusal to a skip and starts an automatic run otherwise", async () => {
    mockAutomatic.mockReturnValue(true);
    (startSreIncidentTriage as jest.Mock).mockResolvedValueOnce({ success: false, status: 402, error: "limit" });
    expect(await startAutomaticIncidentTriage(scope)).toEqual({ skipped: true, reason: "triage_billing" });

    (startSreIncidentTriage as jest.Mock).mockResolvedValueOnce({ success: true, investigationRunId: "run-2" });
    (completeSreIncidentTriage as jest.Mock).mockResolvedValue({ success: true });
    expect(await startAutomaticIncidentTriage(scope)).toEqual({ success: true, investigationRunId: "run-2" });
    expect(startSreIncidentTriage).toHaveBeenLastCalledWith({ ...scope, userId: null, origin: "auto" });
  });
});
