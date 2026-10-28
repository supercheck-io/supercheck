jest.mock("@/lib/ai/ai-provider", () => ({
  validateAIConfiguration: jest.fn(),
}));
import { validateAIConfiguration } from "@/lib/ai/ai-provider";

jest.mock("@/sre/lib/feature-gates", () => ({
  isSreBackgroundAlertTriageEnabled: jest.fn(),
  isSreAutomaticTriageEnabled: jest.fn(),
  isSreAlertCorrelationEnabled: jest.fn(() => false),
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ warn: jest.fn() }) }));
jest.mock("@/lib/sre/incident-notifier", () => ({ notifyIncidentEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/sre/incident-lifecycle", () => ({
  applySourceRecovery: jest.fn(),
  reopenRecentlyAutoResolved: jest.fn(),
  findOpenIncidentForSource: jest.fn().mockResolvedValue(null),
  announceSystemTransition: jest.fn().mockResolvedValue(undefined),
  getDefaultAssigneeId: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/status-page-reconciliation", () => ({ linkStatusPageIncidentsToSreIncident: jest.fn().mockResolvedValue([]) }));
jest.mock("@/sre/lib/triage-runner", () => ({ runSreIncidentTriage: jest.fn() }));

const selectQueue: unknown[][] = [];
const inserts: unknown[] = [];
function chain(result: unknown[]) {
  const node: Record<string, unknown> = {};
  for (const name of ["from", "where", "limit", "leftJoin", "innerJoin", "orderBy", "set"]) {
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
import { runSreIncidentTriage } from "@/sre/lib/triage-runner";
import { db } from "@/utils/db";
import { processSreBackgroundAlertTriageJob } from "./background-alert-triage";

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
      expect(runSreIncidentTriage).not.toHaveBeenCalled();
    });

    it("opens the incident but skips triage when no AI provider is configured", async () => {
      mockAutomatic.mockReturnValue(true);
      (validateAIConfiguration as jest.Mock).mockImplementation(() => { throw new Error("missing key"); });
      selectQueue.push([alertRow()]);
      freshIncidentQueue();
      expect(await processSreBackgroundAlertTriageJob(JOB)).toEqual({ success: true, skipped: true, reason: "ai_not_configured" });
      expect(insertedIncident()).toBeDefined();
      expect(runSreIncidentTriage).not.toHaveBeenCalled();
    });

    it("runs AI triage when automation is on and AI is configured", async () => {
      mockAutomatic.mockReturnValue(true);
      (runSreIncidentTriage as jest.Mock).mockResolvedValue({ success: true, investigationRunId: "run-1" });
      selectQueue.push([alertRow()]);
      freshIncidentQueue();
      expect(await processSreBackgroundAlertTriageJob(JOB)).toMatchObject({ success: true, skipped: false, investigationRunId: "run-1" });
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

    it("reopens a recently auto-resolved incident instead of creating one", async () => {
      (reopenRecentlyAutoResolved as jest.Mock).mockResolvedValue({ incidentId: "inc-old", assigneeUserId: "u1", alreadyTriaged: true });
      selectQueue.push([alertRow()]);
      selectQueue.push([], [{ id: "ae-1" }], []);
      expect(await processSreBackgroundAlertTriageJob(JOB)).toEqual({ success: true, skipped: true, reason: "already_triaged" });
      expect(insertedIncident()).toBeUndefined();
      expect(announceSystemTransition).toHaveBeenCalledWith("org-1", "proj-1", "inc-old", "reopened", expect.objectContaining({ assigneeUserId: "u1" }));
      expect(notifyIncidentEvent).not.toHaveBeenCalled();
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
