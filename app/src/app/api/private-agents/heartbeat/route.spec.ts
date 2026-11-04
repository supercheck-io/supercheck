/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/utils/db", () => ({ db: { transaction: jest.fn() } }));
jest.mock("@/lib/auth/device-auth-rate-limit", () => ({ allowDeviceAuthRequest: jest.fn() }));
jest.mock("../jobs/auth", () => ({
  authenticatePrivateAgent: jest.fn(),
  unauthorized: jest.fn(() => new Response("{}", { status: 401 })),
}));

import { POST } from "./route";
import { allowDeviceAuthRequest } from "@/lib/auth/device-auth-rate-limit";
import { authenticatePrivateAgent } from "../jobs/auth";
import { db } from "@/utils/db";

describe("Private Agent heartbeat rate limit", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 without limiting or writing when authentication fails", async () => {
    jest.mocked(authenticatePrivateAgent).mockResolvedValue(null as never);
    const res = await POST(
      new NextRequest("http://localhost/api/private-agents/heartbeat", {
        method: "POST",
        headers: { authorization: "Bearer x", "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(401);
    expect(allowDeviceAuthRequest).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("returns 401 without writing when the body names a different agent", async () => {
    jest.mocked(authenticatePrivateAgent).mockResolvedValue({
      agent: { id: "3f2b8c1e-5a4d-4e6f-8b7a-9c0d1e2f3a4b" },
      credential: { id: "cred-1" },
    } as never);
    jest.mocked(allowDeviceAuthRequest).mockResolvedValue(true);
    const res = await POST(
      new NextRequest("http://localhost/api/private-agents/heartbeat", {
        method: "POST",
        headers: { authorization: "Bearer x", "content-type": "application/json" },
        body: JSON.stringify({ agentId: "9a1b2c3d-5a4d-4e6f-8b7a-9c0d1e2f3a4b", protocolVersion: "1", agentVersion: "1.0.0" }),
      })
    );
    expect(res.status).toBe(401);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("returns 429 without writing when the credential is over its limit", async () => {
    jest.mocked(authenticatePrivateAgent).mockResolvedValue({
      agent: { id: "3f2b8c1e-5a4d-4e6f-8b7a-9c0d1e2f3a4b" },
      credential: { id: "cred-1" },
    } as never);
    jest.mocked(allowDeviceAuthRequest).mockResolvedValue(false);
    const res = await POST(
      new NextRequest("http://localhost/api/private-agents/heartbeat", {
        method: "POST",
        headers: { authorization: "Bearer x", "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(429);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("asks the limiter to fail open, so a Redis outage does not take agents offline", async () => {
    jest.mocked(authenticatePrivateAgent).mockResolvedValue({
      agent: { id: "3f2b8c1e-5a4d-4e6f-8b7a-9c0d1e2f3a4b" },
      credential: { id: "cred-1" },
    } as never);
    jest.mocked(allowDeviceAuthRequest).mockResolvedValue(true);
    jest.mocked(db.transaction).mockResolvedValue(true as never);
    const res = await POST(
      new NextRequest("http://localhost/api/private-agents/heartbeat", {
        method: "POST",
        headers: { authorization: "Bearer x", "content-type": "application/json" },
        body: JSON.stringify({ agentId: "3f2b8c1e-5a4d-4e6f-8b7a-9c0d1e2f3a4b", protocolVersion: "1", agentVersion: "1.0.0" }),
      })
    );
    expect(res.status).toBe(200);
    expect(jest.mocked(allowDeviceAuthRequest).mock.calls.at(-1)?.[1]).toEqual({ failOpen: true });
  });

  it("rejects a heartbeat that raced with a disable instead of reviving the agent", async () => {
    jest.mocked(authenticatePrivateAgent).mockResolvedValue({
      agent: { id: "3f2b8c1e-5a4d-4e6f-8b7a-9c0d1e2f3a4b" },
      credential: { id: "cred-1" },
    } as never);
    jest.mocked(allowDeviceAuthRequest).mockResolvedValue(true);
    jest.mocked(db.transaction).mockResolvedValue(false as never);
    const res = await POST(
      new NextRequest("http://localhost/api/private-agents/heartbeat", {
        method: "POST",
        headers: { authorization: "Bearer x", "content-type": "application/json" },
        body: JSON.stringify({ agentId: "3f2b8c1e-5a4d-4e6f-8b7a-9c0d1e2f3a4b", protocolVersion: "1", agentVersion: "1.0.0" }),
      })
    );
    expect(res.status).toBe(401);
  });
});
