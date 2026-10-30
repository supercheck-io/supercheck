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
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/sre/incident-notifier", () => ({ notifyIncidentEvent: jest.fn(async () => undefined) }));
jest.mock("@/sre/lib/session-store", () => ({ listSreConversations: jest.fn().mockResolvedValue([]) }));
jest.mock("@/sre/lib/triage-automation", () => ({ maybeRunAutomaticSreTriage: jest.fn() }));
jest.mock("@/sre/lib/feature-gates", () => ({ isSreInvestigationAgentEnabled: jest.fn(() => true), isSreAlertCorrelationEnabled: jest.fn(() => false) }));

import { db } from "@/utils/db";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { failStaleSreInvestigationRunsForIncident } from "@/sre/lib/stale-run-recovery";
import { createSreIncidentFromAlert, getSreIncidentDetails, getSreIncidents, updateSreIncident } from "./sre-incidents";

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
    (db.query.sreIncidents.findFirst as jest.Mock).mockResolvedValue({ id: incidentId, status: "resolved" });
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
    expect(inserted.map((row) => (row.eventData as { state: string }).state)).toEqual(["incident_updated", "reopened"]);
    expect(jest.requireMock("@/lib/sre/incident-notifier").notifyIncidentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId, event: "reopened" }),
    );
  });

  it("reopening straight to Monitoring records mitigation", async () => {
    const incidentId = "00000000-0000-4000-8000-000000000001";
    (db.query.sreIncidents.findFirst as jest.Mock).mockResolvedValue({ id: incidentId, status: "resolved", mitigatedAt: null });
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
      orderBy: () => chain(rows), limit: () => chain(rows),
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
  });
});
