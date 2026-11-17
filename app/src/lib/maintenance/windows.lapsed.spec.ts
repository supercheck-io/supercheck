/** @jest-environment node */
const NOW = Date.now();
let rows: unknown[][] = [];
jest.mock("@/utils/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit"]) chain[m] = () => chain;
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(rows.shift() ?? []).then(res);
  return { db: chain };
});
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({ checkMaintenanceWriteRateLimit: async () => ({ allowed: true }) }));
jest.mock("@/lib/status-page-incident-core", () => ({ createStatusPageIncident: jest.fn(), findStatusPageTargetError: jest.fn() }));
jest.mock("@/lib/sre/incident-resources", () => ({ resolveIncidentResources: jest.fn() }));
const lapsedWriteBlock = jest.fn();
jest.mock("@/lib/sre/lapsed-org-gate", () => ({ lapsedWriteBlock: (...a: unknown[]) => lapsedWriteBlock(...a) }));

import { cancelMaintenanceWindow, createMaintenanceWindow, endMaintenanceWindow, extendMaintenanceWindow, updateMaintenanceWindow } from "./windows";

const actor = { userId: "u", organizationId: "org-1", orgPendingDeletion: false, project: { id: "p", userRole: "project_editor" } } as never;
const blocked = { ok: false, code: "subscription_required", error: "Active subscription required." };
const id = "018f0000-0000-7000-8000-0000000000d1";
// An ended one-off window: end and cancel answer "already over" without touching anything else.
const overRow = { id, recurrence: "once", cancelledAt: null, completedAt: new Date(NOW - 1000), occurrenceStartsAt: new Date(NOW - 7200_000), occurrenceEndsAt: new Date(NOW - 3600_000), updatedAt: new Date(NOW) };
const input = { title: "Deploy", scope: "project", recurrence: "once", timezone: "UTC", startsOn: "2099-01-01", localStartTime: "01:00", durationMinutes: 60 } as never;

beforeEach(() => {
  jest.clearAllMocks();
  rows = [];
  lapsedWriteBlock.mockResolvedValue(blocked);
});

describe("maintenance writes for a lapsed organization", () => {
  it("refuses create, update and extend with subscription_required", async () => {
    await expect(createMaintenanceWindow(actor, input, "api")).resolves.toEqual(blocked);
    rows = [[overRow], []];
    await expect(updateMaintenanceWindow(actor, id, { title: "New" }, "api")).resolves.toEqual(blocked);
    rows = [[overRow], []];
    await expect(extendMaintenanceWindow(actor, id, { byMinutes: 30 }, "api")).resolves.toEqual(blocked);
    expect(lapsedWriteBlock).toHaveBeenCalledTimes(3);
    expect(lapsedWriteBlock).toHaveBeenCalledWith("org-1");
  });

  it("does not gate ending or cancelling, so responders can clean up", async () => {
    rows = [[overRow], []];
    await expect(endMaintenanceWindow(actor, id, "api")).resolves.toMatchObject({ ok: false, code: "conflict" });
    rows = [[overRow], []];
    await expect(cancelMaintenanceWindow(actor, id, "api")).resolves.toMatchObject({ ok: false, code: "conflict" });
    expect(lapsedWriteBlock).not.toHaveBeenCalled();
  });
});
