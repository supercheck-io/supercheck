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
    jest.mocked(db.transaction).mockResolvedValue(undefined as never);
    await POST(
      new NextRequest("http://localhost/api/private-agents/heartbeat", {
        method: "POST",
        headers: { authorization: "Bearer x", "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(jest.mocked(allowDeviceAuthRequest).mock.calls.at(-1)?.[1]).toEqual({ failOpen: true });
  });
});
