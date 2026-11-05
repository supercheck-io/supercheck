/** @jest-environment node */
import { NextRequest } from "next/server";

const requireAuthContext = jest.fn();
jest.mock("@/lib/auth-context", () => {
  const actual = jest.requireActual("@/lib/auth-context");
  return { ...actual, requireAuthContext: () => requireAuthContext() };
});
jest.mock("@/lib/queue-stats", () => ({ getQueueStats: jest.fn() }));
jest.mock("@/lib/queue-event-hub", () => ({ getQueueEventHub: jest.fn() }));

import { AuthError } from "@/lib/auth-context";
import { GET } from "./route";

const request = () => new NextRequest("http://localhost/api/queue-stats/sse");

describe("GET /api/queue-stats/sse auth", () => {
  it("returns 403 when signed in but not permitted", async () => {
    requireAuthContext.mockRejectedValueOnce(new AuthError("no access", 403));
    expect((await GET(request())).status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    requireAuthContext.mockRejectedValueOnce(new AuthError("no session"));
    expect((await GET(request())).status).toBe(401);
  });

  it("returns 401 for an unexpected auth failure", async () => {
    requireAuthContext.mockRejectedValueOnce(new Error("boom"));
    expect((await GET(request())).status).toBe(401);
  });
});
