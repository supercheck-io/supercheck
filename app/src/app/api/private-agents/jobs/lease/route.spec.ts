/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/utils/db", () => ({
  db: {
    transaction: jest.fn(),
  },
}));

jest.mock("../auth", () => ({
  authenticatePrivateAgent: jest.fn(),
  unauthorized: jest.fn(() => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })),
}));

import { POST } from "./route";

const { db: mockDb } = jest.requireMock("@/utils/db") as {
  db: {
    transaction: jest.Mock;
  };
};

const { authenticatePrivateAgent: mockAuthenticatePrivateAgent } = jest.requireMock("../auth") as {
  authenticatePrivateAgent: jest.Mock;
};

describe("Private Agent job lease route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticatePrivateAgent.mockResolvedValue({
      agent: {
        id: "00000000-0000-0000-0000-000000000001",
        organizationId: "00000000-0000-0000-0000-000000000002",
        supportsSreConnectors: true,
      },
      credential: {
        id: "00000000-0000-0000-0000-000000000003",
      },
    });
  });

  it("requeues expired connector leases before returning no work", async () => {
    const updateSets: Array<Record<string, unknown>> = [];

    const createTx = () => ({
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => {
          updateSets.push(values);
          return { where: jest.fn().mockResolvedValue([]) };
        }),
      })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
              limit: jest.fn().mockResolvedValue([]),
            })),
          })),
        })),
      })),
    });

    mockDb.transaction.mockImplementation(async (callback: (tx: ReturnType<typeof createTx>) => Promise<unknown>) =>
      callback(createTx())
    );

    const request = new NextRequest("http://localhost/api/private-agents/jobs/lease", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ waitMs: 0 }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ job: null });
    expect(updateSets).toContainEqual({
      status: "queued",
      leaseTokenHash: null,
      leaseExpiresAt: null,
      startedAt: null,
    });
  });
});
