/** @jest-environment node */

jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), query: { member: { findFirst: jest.fn() } } } }));
jest.mock("@/lib/rbac/super-admin", () => ({ isSuperAdmin: jest.fn() }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn().mockResolvedValue({ userId: "user-1" }),
  isAuthError: jest.fn(),
}));
jest.mock("@/lib/queue", () => ({ getQueues: jest.fn() }));
jest.mock("@/lib/cancellation-service", () => ({
  setCancellationSignal: jest.fn(),
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/capacity-manager", () => ({ getCapacityManager: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ canCancelRunInProject: jest.fn() }));

import { NextRequest } from "next/server";
import { db } from "@/utils/db";
import { setCancellationSignal } from "@/lib/cancellation-service";
import { isSuperAdmin } from "@/lib/rbac/super-admin";
import { requireAuthContext } from "@/lib/auth-context";
import { canCancelRunInProject } from "@/lib/rbac/middleware";
import { POST } from "./route";

describe("cancel run authorization", () => {
  it("returns 404 without signaling Redis when ownership cannot be established", async () => {
    (db.select as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue({
        leftJoin: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/runs/missing/cancel", {
        method: "POST",
      }),
      { params: Promise.resolve({ runId: "missing" }) },
    );

    expect(response.status).toBe(404);
    expect(setCancellationSignal).not.toHaveBeenCalled();
  });
});


it.each([false, true])("tenant membership gate respects super-admin=%s", async (superAdmin) => {
  jest.clearAllMocks();
  (isSuperAdmin as jest.Mock).mockResolvedValue(superAdmin);
  (canCancelRunInProject as jest.Mock).mockResolvedValue(true);
  (db.query.member.findFirst as jest.Mock).mockResolvedValue(null);
  (db.select as jest.Mock).mockReturnValue({ from: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => [{ jobId: "job", jobOrganizationId: "org", jobProjectId: "project", runStatus: "passed" }] }) }) }) });
  const response = await POST(new NextRequest("http://localhost/api/runs/run/cancel", { method: "POST" }), { params: Promise.resolve({ runId: "run" }) });
  expect(response.status).toBe(superAdmin ? 400 : 403);
  // A super admin reaches the ordinary terminal-run status check, without signaling it.
  expect(setCancellationSignal).not.toHaveBeenCalled();
  if (superAdmin) expect(db.query.member.findFirst).not.toHaveBeenCalled();
});

it("denies a project-scoped CLI token for another project's run, even for a super admin", async () => {
  jest.clearAllMocks();
  (requireAuthContext as jest.Mock).mockResolvedValueOnce({ userId: "user-1", isCliAuth: true, project: { id: "other-project" } });
  (isSuperAdmin as jest.Mock).mockResolvedValue(true);
  (canCancelRunInProject as jest.Mock).mockResolvedValue(true);
  (db.select as jest.Mock).mockReturnValue({ from: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => [{ jobId: "job", jobOrganizationId: "org", jobProjectId: "project", runStatus: "running" }] }) }) }) });
  const response = await POST(new NextRequest("http://localhost/api/runs/run/cancel", { method: "POST" }), { params: Promise.resolve({ runId: "run" }) });
  expect(response.status).toBe(403);
  expect(setCancellationSignal).not.toHaveBeenCalled();
});
