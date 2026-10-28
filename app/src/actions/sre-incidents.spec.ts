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
jest.mock("@/lib/sre/incident-notifier", () => ({ notifyIncidentEvent: jest.fn() }));
jest.mock("@/sre/lib/session-store", () => ({ listSreConversations: jest.fn().mockResolvedValue([]) }));
jest.mock("@/sre/lib/triage-automation", () => ({ maybeRunAutomaticSreTriage: jest.fn() }));
jest.mock("@/sre/lib/feature-gates", () => ({ isSreInvestigationAgentEnabled: jest.fn(() => true) }));

import { db } from "@/utils/db";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { failStaleSreInvestigationRunsForIncident } from "@/sre/lib/stale-run-recovery";
import { createSreIncidentFromAlert, getSreIncidentDetails, updateSreIncident } from "./sre-incidents";

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
    await createSreIncidentFromAlert({ alertHistoryId: "00000000-0000-4000-8000-000000000009" });
    expect(values).toContainEqual(expect.objectContaining({ title: expect.any(String), severity: "sev1" }));
  });
});
