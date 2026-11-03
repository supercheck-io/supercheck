/** @jest-environment node */

import { NextRequest } from "next/server";

const mockUpdate = jest.fn();
const mockTx = {
  select: jest.fn(),
  update: mockUpdate,
  insert: jest.fn(),
};
jest.mock("@/utils/db", () => ({ db: { transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(mockTx)) } }));
jest.mock("@/lib/auth/device-auth-rate-limit", () => ({ allowDeviceAuthRequest: jest.fn() }));

import { POST } from "./route";
import { allowDeviceAuthRequest } from "@/lib/auth/device-auth-rate-limit";
import { db } from "@/utils/db";

const AGENT_ID = "3f2b8c1e-5a4d-4e6f-8b7a-9c0d1e2f3a4b";

function req() {
  return new NextRequest("http://localhost/api/private-agents/registration/exchange", {
    method: "POST",
    headers: { authorization: "Bearer wrong-token", "content-type": "application/json" },
    body: JSON.stringify({ agentId: AGENT_ID, protocolVersion: "1", agentVersion: "1.0.0" }),
  });
}

describe("Private Agent registration exchange abuse limits", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(allowDeviceAuthRequest).mockResolvedValue(true);
    mockTx.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: AGENT_ID, status: "pending", registrationTokenHash: "a".repeat(64), metadata: {} }],
        }),
      }),
    });
  });

  it("does not write to the agent row on a wrong token", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 429 without touching the database when rate limited", async () => {
    jest.mocked(allowDeviceAuthRequest).mockResolvedValue(false);
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
