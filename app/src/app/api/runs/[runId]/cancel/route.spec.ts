/** @jest-environment node */

jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));
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
