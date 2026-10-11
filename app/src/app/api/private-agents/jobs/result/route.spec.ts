/** @jest-environment node */

import { NextRequest } from "next/server";

const mockSelectLimit = jest.fn();
const mockTransaction = jest.fn();

jest.mock("@/utils/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mockSelectLimit }) }) }),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTransaction(fn),
  },
}));

jest.mock("../auth", () => ({
  authenticatePrivateAgent: jest.fn(),
  unauthorized: jest.fn(() => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })),
}));

import { POST } from "./route";

const { authenticatePrivateAgent: mockAuth } = jest.requireMock("../auth") as { authenticatePrivateAgent: jest.Mock };

const jobId = "00000000-0000-4000-8000-000000000010";
const body = { jobId, leaseToken: "scl_" + "a".repeat(40), status: "completed" };

function request(payload: unknown, raw = false) {
  return new NextRequest("http://localhost/api/private-agents/jobs/result", {
    method: "POST",
    body: raw ? (payload as string) : JSON.stringify(payload),
  });
}

describe("Private Agent job result route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({
      agent: { id: "agent-1", organizationId: "org-1" },
      credential: { id: "cred-1" },
    });
  });

  it("returns 400 for malformed JSON instead of 500", async () => {
    const response = await POST(request("{not json", true));
    expect(response.status).toBe(400);
  });

  it("returns 409 when the lease is unknown or expired", async () => {
    mockSelectLimit.mockResolvedValue([]);
    const response = await POST(request(body));
    expect(response.status).toBe(409);
  });

  it("returns 409 when a concurrent or replayed post already finished the job", async () => {
    mockSelectLimit.mockResolvedValue([{ id: jobId, leaseExpiresAt: new Date(Date.now() + 60_000), startedAt: null }]);
    // The guarded UPDATE ... RETURNING matches no row because the job is no longer leased/running.
    mockTransaction.mockImplementation(async (fn) =>
      fn({
        update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
      }),
    );
    const response = await POST(request(body));
    expect(response.status).toBe(409);
  });
});
