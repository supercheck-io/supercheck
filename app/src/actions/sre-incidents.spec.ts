/** @jest-environment node */

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/utils/db", () => ({
  db: { select: jest.fn(), transaction: jest.fn(), query: {
    sreIncidents: { findFirst: jest.fn() },
    sreInvestigationReports: { findFirst: jest.fn().mockResolvedValue(null) },
  } },
}));
jest.mock("@/sre/lib/stale-run-recovery", () => ({ failStaleSreInvestigationRunsForIncident: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn() }));
jest.mock("@/lib/sre/incident-lifecycle", () => ({
  ...jest.requireActual("@/lib/sre/incident-lifecycle"),
  reopenRecentlyAutoResolved: jest.fn().mockResolvedValue(null),
  findOpenIncidentForSource: jest.fn().mockResolvedValue(null),
  noteFailureReturned: jest.fn().mockResolvedValue(false),
  announceSystemTransition: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({ checkSreIncidentUpdateRateLimit: jest.fn(async () => ({ allowed: true })) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/sre/incident-notifier", () => ({ notifyIncidentEvent: jest.fn(async () => undefined) }));
jest.mock("@/lib/sre/incident-watchers", () => ({ watchIncident: jest.fn(async () => undefined), isWatchingIncident: jest.fn(async () => false) }));
jest.mock("@/sre/lib/session-store", () => ({ listSreConversations: jest.fn().mockResolvedValue([]) }));
jest.mock("@/sre/lib/auto-investigate", () => ({ maybeAutoInvestigateOnOpen: jest.fn(async () => ({ handled: false })) }));
jest.mock("@/sre/lib/triage-automation", () => ({ maybeRunAutomaticSreTriage: jest.fn(async () => ({ attempted: false, reason: "disabled" })) }));
jest.mock("@/sre/lib/feature-gates", () => ({ isSreInvestigationAgentEnabled: jest.fn(() => true), isSreAlertCorrelationEnabled: jest.fn(() => false) }));

import { db } from "@/utils/db";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { failStaleSreInvestigationRunsForIncident } from "@/sre/lib/stale-run-recovery";
import { announceSystemTransition, findOpenIncidentForSource, reopenRecentlyAutoResolved } from "@/lib/sre/incident-lifecycle";
import { createManualSreIncident, createSreIncidentFromAlert, getSreIncidentDetails, getSreIncidents, updateSreIncident } from "./sre-incidents";

function selectRows(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), {
    from: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  });
}

describe("getSreIncidentDetails investigation summary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireProjectContext).mockResolvedValue({
      userId: "user-1", organizationId: "org-1",
      project: { id: "project-1", name: "Prod", organizationId: "org-1", isDefault: true, userRole: "project_editor" },
    });
    jest.mocked(checkPermissionWithContext).mockReturnValue(true);
  });

  it.each(["failed", "aborted", "timed_out"])("shows the safe error for %s instead of partial findings", async (status) => {
    (db.select as jest.Mock)
      .mockReturnValueOnce(selectRows([{ id: "incident-1" }]))
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([{
        id: "run-1", status, rootCauseHypothesis: "Unconfirmed hypothesis",
        agentStateSnapshot: { summary: "Partial report", error: "Investigation did not finish" },
      }]))
      .mockReturnValue(selectRows([]));
    const result = await getSreIncidentDetails("incident-1");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.detail.latestInvestigation?.summary).toBe("Investigation did not finish");
    }
  });

  it("returns the triage finding when no full investigation exists", async () => {
    (db.select as jest.Mock)
      .mockReturnValueOnce(selectRows([{ id: "incident-1" }]))
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([{ rootCauseHypothesis: "truncated", agentStateSnapshot: { summary: "Triage: pool exhausted" } }]))
      .mockReturnValue(selectRows([]));
    const result = await getSreIncidentDetails("incident-1");
    expect(result.success && result.detail.triageSummary).toBe("Triage: pool exhausted");
  });

  it("releases a stale running investigation (scoped) before reading the latest run", async () => {
    (db.select as jest.Mock).mockReturnValueOnce(selectRows([{ id: "incident-1" }])).mockReturnValue(selectRows([]));
    await getSreIncidentDetails("incident-1");
    expect(failStaleSreInvestigationRunsForIncident).toHaveBeenCalledWith({
      organizationId: "org-1", projectId: "project-1", incidentId: "incident-1",
    });
  });

  it.each([
    ["timed_out", {}, "SRE investigation did not complete. Please try again."],
    ["completed", {}, "Confirmed hypothesis"],
    ["completed", { summary: "Completed report" }, "Completed report"],
  ])("preserves the appropriate fallback for %s with %j", async (status, agentStateSnapshot, summary) => {
    (db.select as jest.Mock)
      .mockReturnValueOnce(selectRows([{ id: "incident-1" }]))
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([{
        id: "run-1", status, rootCauseHypothesis: "Confirmed hypothesis", agentStateSnapshot,
      }]))
      .mockReturnValue(selectRows([]));
    const result = await getSreIncidentDetails("incident-1");
    expect(result.success).toBe(true);
    if (result.success) expect(result.detail.latestInvestigation?.summary).toBe(summary);
  });

  it("reports a lost update race without adding timeline or audit events", async () => {
    const incidentId = "00000000-0000-4000-8000-000000000001";
    (db.query.sreIncidents.findFirst as jest.Mock).mockResolvedValue({ id: incidentId, status: "investigating" });
    const insert = jest.fn();
    (db.transaction as jest.Mock).mockImplementation(async (callback) => callback({
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
      insert,
    }));
    await expect(updateSreIncident({
      id: incidentId, title: "Updated title", severity: "sev2", status: "identified", primaryServiceId: null,
    })).resolves.toEqual({ success: false, error: "Incident changed by another request — reload and try again" });
    expect(insert).not.toHaveBeenCalled();
    expect(jest.requireMock("@/lib/audit-logger").logAuditEvent).not.toHaveBeenCalled();
  });

  it("reopening from the editor clears the acknowledgement, records the reopen and notifies", async () => {
    const incidentId = "00000000-0000-4000-8000-000000000001";
    (db.query.sreIncidents.findFirst as jest.Mock).mockResolvedValue({ id: incidentId, status: "resolved", severity: "sev2" });
    const sets: Array<Record<string, unknown>> = [];
    const inserted: Array<Record<string, unknown>> = [];
    (db.transaction as jest.Mock).mockImplementation(async (callback) => callback({
      update: () => ({ set: (values: Record<string, unknown>) => {
        sets.push(values);
        return { where: () => ({ returning: async () => [{ id: incidentId, incidentNumber: 4, title: "t" }] }) };
      } }),
      insert: () => ({ values: async (values: Record<string, unknown>) => { inserted.push(values); } }),
    }));
    const result = await updateSreIncident({
      id: incidentId, title: "Checkout down", severity: "sev2", status: "investigating", primaryServiceId: null,
    });
    expect(result).toMatchObject({ success: true });
    expect(sets[0]).toMatchObject({ acknowledgedAt: null, acknowledgedByUserId: null, resolvedAt: null });
    // The previous resolution stays on the incident.
    expect(sets[0]).not.toHaveProperty("resolutionSummary");
    expect(inserted.map((row) => (row.eventData as { state: string }).state)).toEqual(["incident_updated", "reopened"]);
    expect(jest.requireMock("@/lib/sre/incident-notifier").notifyIncidentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId, event: "reopened" }),
    );
  });

  it("writes no timeline event or audit entry when the edit changes nothing", async () => {
    const incidentId = "00000000-0000-4000-8000-000000000001";
    (db.query.sreIncidents.findFirst as jest.Mock).mockResolvedValue({
      id: incidentId, incidentNumber: 4, title: "t", status: "investigating", severity: "sev2", primaryServiceId: null,
    });
    (db.transaction as jest.Mock).mockClear();
    const audit = jest.requireMock("@/lib/audit-logger").logAuditEvent as jest.Mock;
    audit.mockClear();
    const result = await updateSreIncident({ id: incidentId, title: "t", severity: "sev2", status: "investigating", primaryServiceId: null });
    expect(result).toMatchObject({ success: true, changed: false });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses a rate-limited incident edit before reading or writing anything", async () => {
    jest.mocked(jest.requireMock("@/lib/sre/sre-rate-limiter").checkSreIncidentUpdateRateLimit).mockResolvedValueOnce({ allowed: false });
    (db.query.sreIncidents.findFirst as jest.Mock).mockClear();
    const result = await updateSreIncident({ id: "00000000-0000-4000-8000-000000000001", title: "t", severity: "sev1", status: "investigating", primaryServiceId: null });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("Too many") });
    expect(db.query.sreIncidents.findFirst).not.toHaveBeenCalled();
  });

  it("guards the edit on the severity that was read, so a stale read loses with the conflict error", async () => {
    const { PgDialect } = jest.requireActual("drizzle-orm/pg-core");
    const incidentId = "00000000-0000-4000-8000-000000000001";
    (db.query.sreIncidents.findFirst as jest.Mock).mockResolvedValue({ id: incidentId, status: "investigating", severity: "sev3" });
    let guard: unknown;
    (db.transaction as jest.Mock).mockImplementation(async (callback) => callback({
      update: () => ({ set: () => ({ where: (condition: unknown) => { guard = condition; return { returning: async () => [] }; } }) }),
      insert: () => ({ values: async () => undefined }),
    }));
    const result = await updateSreIncident({ id: incidentId, title: "t", severity: "sev1", status: "investigating", primaryServiceId: null });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("changed by another request") });
    const query = new PgDialect().sqlToQuery(guard as never);
    expect(query.sql).toContain('"severity" = $');
    expect(query.params).toContain("sev3");
  });

  it("notifies watchers only when the severity actually changes", async () => {
    const incidentId = "00000000-0000-4000-8000-000000000001";
    (db.query.sreIncidents.findFirst as jest.Mock).mockResolvedValue({ id: incidentId, status: "investigating", severity: "sev3" });
    (db.transaction as jest.Mock).mockImplementation(async (callback) => callback({
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: incidentId, incidentNumber: 4, title: "t" }] }) }) }),
      insert: () => ({ values: async () => undefined }),
    }));
    const notify = jest.requireMock("@/lib/sre/incident-notifier").notifyIncidentEvent as jest.Mock;
    await updateSreIncident({ id: incidentId, title: "t", severity: "sev3", status: "investigating", primaryServiceId: null });
    expect(notify).not.toHaveBeenCalled();
    await updateSreIncident({ id: incidentId, title: "t", severity: "sev1", status: "investigating", primaryServiceId: null });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ incidentId, event: "severity_changed", detail: "SEV3 to SEV1" }));
  });

  it("reopening straight to Monitoring records mitigation", async () => {
    const incidentId = "00000000-0000-4000-8000-000000000001";
    (db.query.sreIncidents.findFirst as jest.Mock).mockResolvedValue({ id: incidentId, status: "resolved", severity: "sev2", mitigatedAt: null });
    const sets: Array<Record<string, unknown>> = [];
    (db.transaction as jest.Mock).mockImplementation(async (callback) => callback({
      update: () => ({ set: (values: Record<string, unknown>) => {
        sets.push(values);
        return { where: () => ({ returning: async () => [{ id: incidentId, incidentNumber: 4, title: "t" }] }) };
      } }),
      insert: () => ({ values: async () => undefined }),
    }));
    await updateSreIncident({ id: incidentId, title: "Checkout down", severity: "sev2", status: "verifying", primaryServiceId: null });
    expect(sets[0].mitigatedAt).toBeInstanceOf(Date);
  });

  it("groups by every plain column the detail query selects (Postgres rejects the rest)", async () => {
    const { Column, sql } = jest.requireActual("drizzle-orm");
    const { PgDialect } = jest.requireActual("drizzle-orm/pg-core");
    const dialect = new PgDialect();
    const render = (column: unknown) => dialect.sqlToQuery(sql`${column}`).sql;
    const query = selectRows([]);
    (db.select as jest.Mock).mockReturnValueOnce(query).mockReturnValue(selectRows([]));
    await getSreIncidentDetails("incident-1");
    const selected = (db.select as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    const grouped = new Set(query.groupBy.mock.calls[0].map(render));
    // sre_incidents is grouped by its primary key, so its own columns are functionally dependent.
    const missing = Object.entries(selected)
      .filter(([, column]) => column instanceof Column)
      .map(([, column]) => render(column))
      .filter((name) => !name.startsWith('"sre_incidents".') && !grouped.has(name));
    expect(missing).toEqual([]);
  });
});

describe("getSreIncidents scope and cap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireProjectContext).mockResolvedValue({
      userId: "user-1", organizationId: "org-1",
      project: { id: "project-1", name: "Prod", organizationId: "org-1", isDefault: true, userRole: "project_editor" },
    });
    jest.mocked(checkPermissionWithContext).mockReturnValue(true);
  });

  async function whereSql(scope?: "active" | "all") {
    const { sql } = jest.requireActual("drizzle-orm");
    const { PgDialect } = jest.requireActual("drizzle-orm/pg-core");
    const query = selectRows([]);
    (db.select as jest.Mock).mockReturnValueOnce(query);
    await getSreIncidents(scope ? { scope } : undefined);
    return new PgDialect().sqlToQuery(sql`${query.where.mock.calls[0][0]}`).params as unknown[];
  }

  it("filters resolved incidents in SQL only for the active scope", async () => {
    expect(await whereSql("active")).toContain("resolved");
    expect(await whereSql("all")).not.toContain("resolved");
  });

  it("caps at 500 rows and reports truncation", async () => {
    const row = (i: number) => ({ id: `incident-${i}` });
    const many = Array.from({ length: 501 }, (_, i) => row(i));
    const query = selectRows(many);
    (db.select as jest.Mock).mockReturnValueOnce(query).mockReturnValue(selectRows([]));
    const result = await getSreIncidents({ scope: "all" });
    expect(query.limit).toHaveBeenCalledWith(501);
    expect(result).toMatchObject({ success: true, truncated: true });
    if (result.success) expect(result.incidents).toHaveLength(500);

    (db.select as jest.Mock).mockReturnValueOnce(selectRows(many.slice(0, 3))).mockReturnValue(selectRows([]));
    expect(await getSreIncidents({ scope: "all" })).toMatchObject({ truncated: false });
  });

  it("tells an all-resolved project apart from an empty one when the active list is empty", async () => {
    (db.select as jest.Mock).mockReturnValueOnce(selectRows([])).mockReturnValueOnce(selectRows([{ id: "i1" }]));
    expect(await getSreIncidents({ scope: "active" })).toMatchObject({ incidents: [], hasIncidents: true });
    (db.select as jest.Mock).mockReturnValueOnce(selectRows([])).mockReturnValueOnce(selectRows([]));
    expect(await getSreIncidents({ scope: "active" })).toMatchObject({ hasIncidents: false });
  });
});

describe("createSreIncidentFromAlert severity", () => {
  it("honours the monitor's configured incident severity", async () => {
    jest.mocked(requireProjectContext).mockResolvedValue({
      userId: "user-1", organizationId: "org-1",
      project: { id: "project-1", name: "Prod", organizationId: "org-1", isDefault: true, userRole: "project_editor" },
    });
    jest.mocked(checkPermissionWithContext).mockReturnValue(true);
    (db.select as jest.Mock).mockReturnValueOnce(selectRows([{
      id: "alert-1", targetType: "monitor", target: "API", monitorId: "mon-1", jobId: null, type: "monitor_failure",
      message: "down", status: "sent", provider: "slack", sentAt: new Date(), monitorName: "API", jobName: null,
      monitorAlertConfig: { incidentSeverity: "sev1" }, jobAlertConfig: null,
    }]));
    const values: unknown[] = [];
    const chain = (rows: unknown[]) => Object.assign(Promise.resolve(rows), {
      from: () => chain(rows), where: () => chain(rows), innerJoin: () => chain(rows), leftJoin: () => chain(rows),
      orderBy: () => chain(rows), limit: () => chain(rows), for: () => chain(rows),
      values: (v: unknown) => { values.push(v); return chain([{ id: "new-id", assigneeUserId: null, incidentNumber: 1 }]); },
      returning: () => chain([{ id: "new-id", assigneeUserId: null, incidentNumber: 1 }]),
      set: () => chain([]),
    });
    (db.transaction as jest.Mock).mockImplementation(async (cb) => cb({
      execute: jest.fn(), select: () => chain([]), insert: () => chain([]), update: () => chain([]),
    }));
    const result = await createSreIncidentFromAlert({ alertHistoryId: "00000000-0000-4000-8000-000000000009" });
    expect(result.success).toBe(true);
    expect(values).toContainEqual(expect.objectContaining({ title: expect.any(String), severity: "sev1" }));
    // A new incident is offered to the project's automatic investigation (a no-op unless the project opted in).
    expect(jest.requireMock("@/sre/lib/auto-investigate").maybeAutoInvestigateOnOpen).toHaveBeenCalled();
  });
});

describe("createSreIncidentFromAlert join/reopen rules", () => {
  const arrange = (sentAt = new Date()) => {
    jest.mocked(announceSystemTransition).mockClear();
    jest.mocked(reopenRecentlyAutoResolved).mockClear();
    jest.mocked(requireProjectContext).mockResolvedValue({
      userId: "user-1", organizationId: "org-1",
      project: { id: "project-1", name: "Prod", organizationId: "org-1", isDefault: true, userRole: "project_editor" },
    });
    jest.mocked(checkPermissionWithContext).mockReturnValue(true);
    (db.select as jest.Mock).mockReturnValueOnce(selectRows([{
      id: "alert-1", targetType: "monitor", target: "API", monitorId: "mon-1", jobId: null, type: "monitor_failure",
      message: "down", status: "sent", provider: "slack", sentAt, monitorName: "API", jobName: null,
      monitorAlertConfig: null, jobAlertConfig: null,
    }]));
    const inserted: unknown[] = [];
    const chain = (rows: unknown[]) => Object.assign(Promise.resolve(rows), {
      from: () => chain(rows), where: () => chain(rows), innerJoin: () => chain(rows), leftJoin: () => chain(rows),
      orderBy: () => chain(rows), limit: () => chain(rows), for: () => chain(rows),
      values: (v: unknown) => { inserted.push(v); return chain([{ id: "alert-event-1" }]); },
      returning: () => chain([{ id: "alert-event-1" }]), set: () => chain([]), onConflictDoNothing: () => chain([]),
    });
    (db.transaction as jest.Mock).mockImplementation(async (cb) => cb({
      execute: jest.fn(), select: () => chain([]), insert: () => chain([]), update: () => chain([]),
    }));
    return inserted;
  };
  const ref = { incidentNumber: 4, title: "API down" };

  it("does not wait for, or fail on, the reopen announcement", async () => {
    arrange();
    jest.mocked(reopenRecentlyAutoResolved).mockResolvedValueOnce({ incidentId: "inc-old", ...ref, assigneeUserId: "u-9", alreadyTriaged: false, stale: false });
    jest.mocked(announceSystemTransition).mockReturnValueOnce(new Promise(() => undefined));
    await expect(createSreIncidentFromAlert({ alertHistoryId: "00000000-0000-4000-8000-000000000009" })).resolves.toMatchObject({ success: true, existing: true });
    arrange();
    jest.mocked(reopenRecentlyAutoResolved).mockResolvedValueOnce({ incidentId: "inc-old", ...ref, assigneeUserId: "u-9", alreadyTriaged: false, stale: false });
    jest.mocked(announceSystemTransition).mockRejectedValueOnce(new Error("provider down"));
    await expect(createSreIncidentFromAlert({ alertHistoryId: "00000000-0000-4000-8000-000000000009" })).resolves.toMatchObject({ success: true });
  });

  it("reopens a recently auto-resolved incident instead of creating one, and announces it", async () => {
    arrange();
    jest.mocked(reopenRecentlyAutoResolved).mockResolvedValueOnce({ incidentId: "inc-old", ...ref, assigneeUserId: "u-9", alreadyTriaged: false, stale: false });
    const result = await createSreIncidentFromAlert({ alertHistoryId: "00000000-0000-4000-8000-000000000009" });
    expect(result).toMatchObject({ success: true, existing: true, incident: { id: "inc-old", incidentNumber: 4 } });
    expect(announceSystemTransition).toHaveBeenCalledWith("org-1", "project-1", "inc-old", "reopened", expect.objectContaining({ assigneeUserId: "u-9" }));
  });

  it("does not reopen for an alert older than the reopen window, but still joins an open incident", async () => {
    arrange(new Date(Date.now() - 2 * 60 * 60 * 1000));
    jest.mocked(findOpenIncidentForSource).mockResolvedValueOnce({ id: "inc-open", ...ref, triageInvestigationRunId: null });
    const result = await createSreIncidentFromAlert({ alertHistoryId: "00000000-0000-4000-8000-000000000009" });
    expect(reopenRecentlyAutoResolved).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ allowReopen: false }));
    expect(announceSystemTransition).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, existing: true, incident: { id: "inc-open" } });
  });

  it("still joins the resolved incident an old alert fired before (stale join)", async () => {
    arrange(new Date(Date.now() - 2 * 60 * 60 * 1000));
    jest.mocked(reopenRecentlyAutoResolved).mockResolvedValueOnce({ incidentId: "inc-resolved", ...ref, assigneeUserId: null, alreadyTriaged: true, stale: true });
    const result = await createSreIncidentFromAlert({ alertHistoryId: "00000000-0000-4000-8000-000000000009" });
    expect(result).toMatchObject({ success: true, existing: true, incident: { id: "inc-resolved" } });
    expect(announceSystemTransition).not.toHaveBeenCalled();
  });

  it("notes a returned failure when the alert is already linked to an open incident", async () => {
    arrange();
    const rows = [{ id: "inc-linked", incidentNumber: 4, title: "API down" }];
    const chain = (): unknown => Object.assign(Promise.resolve(rows), {
      from: chain, where: chain, innerJoin: chain, leftJoin: chain, orderBy: chain, limit: chain, for: chain,
      set: chain, values: chain, returning: chain, onConflictDoNothing: chain,
    });
    (db.transaction as jest.Mock).mockImplementation(async (cb) => cb({ execute: jest.fn(), select: chain, insert: chain, update: chain }));
    const { noteFailureReturned } = jest.requireMock("@/lib/sre/incident-lifecycle");
    noteFailureReturned.mockClear();
    const result = await createSreIncidentFromAlert({ alertHistoryId: "00000000-0000-4000-8000-000000000009" });
    expect(result).toMatchObject({ success: true, existing: true, incident: { id: "inc-linked" } });
    expect(noteFailureReturned).toHaveBeenCalledWith(expect.anything(), "inc-linked", expect.any(Date));
  });

  it("runs the project's automatic investigation before instance-wide triage and skips triage when it started", async () => {
    arrange();
    const auto = jest.requireMock("@/sre/lib/auto-investigate").maybeAutoInvestigateOnOpen as jest.Mock;
    const triage = jest.requireMock("@/sre/lib/triage-automation").maybeRunAutomaticSreTriage as jest.Mock;
    auto.mockClear().mockResolvedValueOnce({ handled: true });
    triage.mockClear();
    const result = await createSreIncidentFromAlert({ alertHistoryId: "00000000-0000-4000-8000-000000000009" });
    expect(result).toMatchObject({ success: true, triage: { attempted: false, reason: "auto_investigation" } });
    expect(auto).toHaveBeenCalled();
    expect(triage).not.toHaveBeenCalled();
  });

  it("joins the source's open incident instead of creating a duplicate", async () => {
    arrange();
    jest.mocked(findOpenIncidentForSource).mockResolvedValueOnce({ id: "inc-open", ...ref, triageInvestigationRunId: null });
    const result = await createSreIncidentFromAlert({ alertHistoryId: "00000000-0000-4000-8000-000000000009" });
    expect(result).toMatchObject({ success: true, existing: true, incident: { id: "inc-open" } });
    expect(announceSystemTransition).not.toHaveBeenCalled();
  });
});

describe("createManualSreIncident default assignee", () => {
  it("assigns a hand-created incident to its creator", async () => {
    jest.mocked(requireProjectContext).mockResolvedValue({
      userId: "creator-1", organizationId: "org-1",
      project: { id: "project-1", name: "Prod", organizationId: "org-1", isDefault: true, userRole: "project_editor" },
    });
    jest.mocked(checkPermissionWithContext).mockReturnValue(true);
    const incidentValues: Record<string, unknown>[] = [];
    (db.transaction as jest.Mock).mockImplementation(async (callback) => callback({
      execute: jest.fn(),
      select: () => selectRows([{ nextIncidentNumber: 4 }]),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          incidentValues.push(values);
          return { returning: async () => [{ id: "incident-1", incidentNumber: 4, title: "t" }] };
        },
      }),
    }));
    const result = await createManualSreIncident({ title: "Checkout down", severity: "sev2" } as never);
    expect(result.success).toBe(true);
    expect(incidentValues[0]).toMatchObject({ createdByUserId: "creator-1", assigneeUserId: "creator-1" });
    expect(jest.requireMock("@/sre/lib/auto-investigate").maybeAutoInvestigateOnOpen).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: "incident-1", userId: "creator-1" }),
    );
    expect(jest.requireMock("@/lib/sre/incident-watchers").watchIncident).toHaveBeenCalledWith(expect.anything(), "incident-1", "creator-1");
    expect(jest.requireMock("@/lib/sre/incident-notifier").notifyIncidentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: "incident-1", event: "created", actorUserId: "creator-1" }),
    );
  });
});
