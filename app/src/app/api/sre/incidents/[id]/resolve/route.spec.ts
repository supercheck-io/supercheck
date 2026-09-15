/** @jest-environment node */

import { NextRequest } from "next/server";

const mockRequirePermissions = jest.fn();
const mockSameOrigin = jest.fn();
const mockAudit = jest.fn();
const mockTransaction = jest.fn();

jest.mock("../../../_auth", () => ({
  requireSreApiPermissions: (...args: unknown[]) => mockRequirePermissions(...args),
  requireSreSameOriginRequest: (...args: unknown[]) => mockSameOrigin(...args),
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: (...args: unknown[]) => mockAudit(...args) }));
jest.mock("@/utils/db", () => ({ db: { transaction: (...args: unknown[]) => mockTransaction(...args) } }));

import { POST } from "./route";

const context = {
  userId: "018f0000-0000-7000-8000-000000000001",
  organizationId: "018f0000-0000-7000-8000-000000000002",
  project: { id: "018f0000-0000-7000-8000-000000000003", name: "Prod", userRole: "project_admin" },
  isCliAuth: true,
};
const incidentId = "018f0000-0000-7000-8000-000000000004";

function request(body: unknown) {
  return new NextRequest(`https://app.supercheck.io/api/sre/incidents/${incidentId}/resolve`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/sre/incidents/[id]/resolve", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSameOrigin.mockReturnValue(null);
    mockRequirePermissions.mockResolvedValue({ success: true, context });
  });

  it("rejects missing resolution comments before touching the database", async () => {
    const response = await POST(request({ comment: "" }), { params: Promise.resolve({ id: incidentId }) });
    expect(response.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("resolves once and records timeline and audit events", async () => {
    const returning = jest.fn().mockResolvedValue([{ id: incidentId, incidentNumber: 42, title: "Checkout down" }]);
    const where = jest.fn(() => ({ returning }));
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));
    const values = jest.fn().mockResolvedValue(undefined);
    const insert = jest.fn(() => ({ values }));
    mockTransaction.mockImplementation(async (callback) => callback({ update, insert }));

    const response = await POST(request({ comment: "Rolled back the deployment" }), { params: Promise.resolve({ id: incidentId }) });
    expect(response.status).toBe(200);
    expect((await response.json()).alreadyResolved).toBe(false);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      incidentId,
      eventData: { state: "resolved", comment: "Rolled back the deployment" },
      actorUserId: context.userId,
    }));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ resourceId: incidentId, action: "sre_incident_resolved" }));
  });

  it("is idempotent when the incident is already resolved", async () => {
    const returning = jest.fn().mockResolvedValue([]);
    const update = jest.fn(() => ({ set: () => ({ where: () => ({ returning }) }) }));
    const limit = jest.fn().mockResolvedValue([{ id: incidentId, incidentNumber: 42, title: "Checkout down", status: "resolved" }]);
    const select = jest.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }));
    const insert = jest.fn();
    mockTransaction.mockImplementation(async (callback) => callback({ update, select, insert }));

    const response = await POST(request({ comment: "Repeated automation call" }), { params: Promise.resolve({ id: incidentId }) });
    expect(response.status).toBe(200);
    expect((await response.json()).alreadyResolved).toBe(true);
    expect(insert).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
