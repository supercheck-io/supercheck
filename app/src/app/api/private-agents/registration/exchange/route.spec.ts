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

import { hashApiKey } from "@/lib/security/api-key-hash";
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
  it("does not reveal a disabled agent to a caller without its token", async () => {
    mockTx.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: AGENT_ID, status: "disabled", registrationTokenHash: "a".repeat(64), metadata: {} }],
        }),
      }),
    });
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  it("returns 403 for a disabled agent when the token is correct", async () => {
    mockTx.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: async () => [
            { id: AGENT_ID, status: "disabled", registrationTokenHash: hashApiKey("wrong-token"), metadata: {} },
          ],
        }),
      }),
    });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("keeps the exchange limiter fail-closed", async () => {
    await POST(req());
    expect(jest.mocked(allowDeviceAuthRequest).mock.calls[0][1]).toBeUndefined();
  });

  it("keys the per-agent bucket by client IP so others cannot lock the agent out", async () => {
    await POST(req());
    const limits = jest.mocked(allowDeviceAuthRequest).mock.calls[0][0];
    const agentLimit = limits.find((limit) => limit.scope === "pa-exchange-agent");
    expect(agentLimit?.subject).toMatch(new RegExp(`^${AGENT_ID}:`));
  });
});
