/** @jest-environment node */
import { NextRequest } from "next/server";

jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: jest.fn(() => false),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(() => true),
}));
jest.mock("@/sre/lib/background-alert-triage-queue", () => ({
  enqueueSreAlertTriageJob: jest.fn(),
}));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), insert: jest.fn() } }));

import { POST } from "./route";

const { requireAuthContext } = jest.requireMock("@/lib/auth-context") as { requireAuthContext: jest.Mock };
const { db } = jest.requireMock("@/utils/db") as { db: { select: jest.Mock; insert: jest.Mock } };
const { enqueueSreAlertTriageJob } = jest.requireMock("@/sre/lib/background-alert-triage-queue") as {
  enqueueSreAlertTriageJob: jest.Mock;
};

const MONITOR_ID = "018f0000-0000-7000-8000-0000000000aa";

function mockSourceLookup(rows: Array<{ id: string }>) {
  const chain = { from: () => chain, where: () => chain, limit: () => Promise.resolve(rows) };
  db.select.mockReturnValue(chain);
}

function mockInsert() {
  const values = jest.fn(() => ({ returning: () => Promise.resolve([{ id: "h1" }]) }));
  db.insert.mockReturnValue({ values });
  return values;
}

const post = (body: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/alerts/history", {
    method: "POST",
    body: JSON.stringify({
      type: "monitor_recovery",
      message: "up",
      target: "https://example.com",
      targetType: "monitor",
      provider: "slack",
      status: "sent",
      ...body,
    }),
  }));

describe("POST /api/alerts/history", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requireAuthContext.mockResolvedValue({
      userId: "u1",
      organizationId: "org-a",
      project: { id: "project-a", name: "A", organizationId: "org-a", userRole: "project_editor" },
      isCliAuth: false,
    });
  });

  it("rejects a monitor outside the caller's project without writing or opening an incident", async () => {
    mockSourceLookup([]);
    const values = mockInsert();

    const response = await post({ monitorId: MONITOR_ID });

    expect(response.status).toBe(404);
    expect(values).not.toHaveBeenCalled();
    expect(enqueueSreAlertTriageJob).not.toHaveBeenCalled();
  });

  it("requires the id that matches targetType", async () => {
    mockInsert();
    expect((await post({ jobId: MONITOR_ID })).status).toBe(400);
    expect((await post({ monitorId: MONITOR_ID, jobId: MONITOR_ID })).status).toBe(400);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("records and enqueues an alert for the caller's own monitor", async () => {
    mockSourceLookup([{ id: MONITOR_ID }]);
    const values = mockInsert();

    const response = await post({ monitorId: MONITOR_ID });

    expect(response.status).toBe(200);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ monitorId: MONITOR_ID, jobId: null }));
    expect(enqueueSreAlertTriageJob).toHaveBeenCalledWith({ alertHistoryId: "h1" });
  });
});
