/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    selectDistinctOn: jest.fn(),
    transaction: jest.fn(),
  },
}));

// The real scheduler opens BullMQ/Redis connections that keep the Jest worker alive.
jest.mock("@/lib/job-scheduler", () => ({ scheduleJob: jest.fn().mockResolvedValue("scheduled-job-id") }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: jest.fn(),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(),
}));

jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: {
    blockUntilSubscribed: jest.fn(),
    requireValidPolarCustomer: jest.fn(),
  },
}));

jest.mock("@/lib/notification-providers/ownership", () => ({
  validateNotificationProviderOwnership: jest.fn(),
}));

jest.mock("@/lib/server-actions/update-job", () => {
  const { z } = jest.requireActual("zod");
  return {
    updateJob: jest.fn(),
    jobNameSchema: z.string().trim().min(1, "Job name is required.").max(255, "Job name must be at most 255 characters."),
    jobDescriptionSchema: z.string().max(2000, "Description must be at most 2000 characters."),
    MAX_JOB_TESTS: 50,
    JOB_CONFLICT_ERROR: "Job changed since you opened it — reload",
  };
});

import { updateJob } from "@/lib/server-actions/update-job";
import { GET, POST, PUT } from "./route";

const { db: mockDb } = jest.requireMock("@/utils/db") as {
  db: {
    select: jest.Mock;
    selectDistinctOn: jest.Mock;
    transaction: jest.Mock;
  };
};

const {
  requireAuthContext: mockRequireAuthContext,
  isAuthError: mockIsAuthError,
} = jest.requireMock("@/lib/auth-context") as {
  requireAuthContext: jest.Mock;
  isAuthError: jest.Mock;
};

const { checkPermissionWithContext: mockCheckPermissionWithContext } =
  jest.requireMock("@/lib/rbac/middleware") as {
    checkPermissionWithContext: jest.Mock;
  };

const { subscriptionService: mockSubscriptionService } = jest.requireMock(
  "@/lib/services/subscription-service",
) as {
  subscriptionService: {
    blockUntilSubscribed: jest.Mock;
    requireValidPolarCustomer: jest.Mock;
  };
};

const {
  validateNotificationProviderOwnership:
    mockValidateNotificationProviderOwnership,
} = jest.requireMock("@/lib/notification-providers/ownership") as {
  validateNotificationProviderOwnership: jest.Mock;
};

const TEST_ID = "00000000-0000-4000-8000-0000000000a1";
const mockInsertValues = jest.fn();

describe("Jobs route regressions", () => {
  const authContext = {
    userId: "user-1",
    organizationId: "org-1",
    project: { id: "project-1", name: "Project" },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAuthContext.mockResolvedValue(authContext);
    mockIsAuthError.mockReturnValue(false);
    mockCheckPermissionWithContext.mockReturnValue(true);
    mockSubscriptionService.blockUntilSubscribed.mockResolvedValue(undefined);
    mockSubscriptionService.requireValidPolarCustomer.mockResolvedValue(
      undefined,
    );
    mockValidateNotificationProviderOwnership.mockResolvedValue(["provider-1"]);
  });

  it("GET /api/jobs returns normalized pagination metadata when page is empty", async () => {
    const countQuery = {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([{ count: 0 }]),
      }),
    };

    const jobsQuery = {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              offset: jest.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    };

    mockDb.select.mockReturnValueOnce(countQuery).mockReturnValueOnce(jobsQuery);

    const request = new NextRequest("http://localhost/api/jobs?page=2&limit=20");
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.pagination).toEqual({
      total: 0,
      page: 2,
      limit: 20,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
    });
  });

  it.each([true, false])("POST /api/jobs rejects unauthorized providers when alerts enabled=%s", async (enabled) => {
    mockValidateNotificationProviderOwnership.mockRejectedValueOnce(
      new Error("Invalid or unauthorized notification provider IDs"),
    );

    const request = new NextRequest("http://localhost/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Nightly Job",
        description: "Nightly",
        cronSchedule: "0 * * * *",
        tests: [{ id: TEST_ID }],
        alertConfig: {
          enabled,
          notificationProviders: ["provider-unauthorized"],
          alertOnFailure: true,
          alertOnSuccess: false,
          alertOnTimeout: false,
          failureThreshold: 1,
          recoveryThreshold: 1,
          customMessage: "",
        },
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Invalid or unauthorized notification provider IDs");
    expect(mockValidateNotificationProviderOwnership).toHaveBeenCalledWith({
      providerIds: ["provider-unauthorized"],
      organizationId: "org-1",
      projectId: "project-1",
    });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  describe("GET /api/jobs includeScript", () => {
    // Every query in the route is a chain that is finally awaited; resolve whichever it ends on.
    const chain = (rows: unknown[]) => {
      const node: Record<string, unknown> = {};
      for (const method of ["from", "where", "orderBy", "limit", "offset", "innerJoin"]) node[method] = jest.fn(() => node);
      node.then = (resolve: (value: unknown[]) => unknown) => resolve(rows);
      return node;
    };
    const encoded = Buffer.from("test('a', async () => {});").toString("base64");

    function mockJobWithTest() {
      mockDb.select
        .mockReturnValueOnce(chain([{ count: 1 }]))
        .mockReturnValueOnce(chain([{ id: "job-1", name: "Nightly", createdAt: new Date() }]))
        .mockReturnValueOnce(chain([{ jobId: "job-1", testId: "t-1", title: "A", type: "browser", script: encoded }]))
        .mockReturnValueOnce(chain([]));
      mockDb.selectDistinctOn.mockReturnValueOnce(chain([]));
    }

    it("loads one latest run per job with DISTINCT ON, not every run", async () => {
      mockJobWithTest();
      await GET(new NextRequest("http://localhost/api/jobs"));
      expect(mockDb.selectDistinctOn).toHaveBeenCalledTimes(1);
    });

    it("leaves scripts out by default", async () => {
      mockJobWithTest();
      const body = await (await GET(new NextRequest("http://localhost/api/jobs"))).json();
      expect(body.data[0].tests[0]).not.toHaveProperty("script");
    });

    it("serves smaller pages when scripts are included", async () => {
      mockJobWithTest();
      const body = await (await GET(new NextRequest("http://localhost/api/jobs?includeScript=true&limit=100"))).json();
      expect(body.pagination.limit).toBe(25);
      mockJobWithTest();
      const plain = await (await GET(new NextRequest("http://localhost/api/jobs?limit=100"))).json();
      expect(plain.pagination.limit).toBe(100);
    });

    it.each(["limit=abc", "limit=", "page=abc", "page=&limit=NaN", "page=99999999999999999999"])("falls back to defaults for a non-numeric pagination value (%s)", async (query) => {
      mockJobWithTest();
      const response = await GET(new NextRequest(`http://localhost/api/jobs?${query}`));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.pagination).toMatchObject({ page: 1, limit: 100 });
    });

    it("includes the decoded script when asked", async () => {
      mockJobWithTest();
      const body = await (await GET(new NextRequest("http://localhost/api/jobs?includeScript=true"))).json();
      expect(body.data[0].tests[0].script.trim()).toBe("test('a', async () => {});");
    });
  });

  it("POST /api/jobs rejects duplicate test IDs", async () => {
    const request = new NextRequest("http://localhost/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Nightly Job",
        description: "Nightly",
        cronSchedule: "0 * * * *",
        tests: [{ id: TEST_ID }, { id: TEST_ID }],
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Duplicate test IDs");
    expect(mockSubscriptionService.blockUntilSubscribed).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("PUT /api/jobs rejects jobType changes after creation", async () => {
    const existingJobQuery = {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([
            {
              id: "00000000-0000-4000-8000-000000000005",
              projectId: "project-1",
              organizationId: "org-1",
              jobType: "playwright",
            },
          ]),
        }),
      }),
    };

    mockDb.select.mockReturnValueOnce(existingJobQuery);

    const request = new Request("http://localhost/api/jobs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "00000000-0000-4000-8000-000000000005",
        name: "Nightly Job",
        description: "Nightly",
        cronSchedule: "0 * * * *",
        jobType: "k6",
        tests: [{ id: TEST_ID }],
      }),
    });

    const response = await PUT(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Job type cannot be changed");
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("PUT /api/jobs rejects a provider outside the current project", async () => {
    mockDb.select.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{
            id: "00000000-0000-4000-8000-000000000005", projectId: "project-1", organizationId: "org-1", jobType: "playwright",
          }]),
        }),
      }),
    });
    mockValidateNotificationProviderOwnership.mockRejectedValueOnce(new Error("Unauthorized provider"));

    const response = await PUT(new Request("http://localhost/api/jobs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "00000000-0000-4000-8000-000000000005", name: "Nightly Job", description: "Nightly",
        cronSchedule: "0 * * * *", tests: [{ id: TEST_ID }],
        alertConfig: { enabled: true, notificationProviders: ["foreign-provider"] },
      }),
    }));

    expect(response.status).toBe(400);
    expect(mockValidateNotificationProviderOwnership).toHaveBeenCalledWith({
      providerIds: ["foreign-provider"], organizationId: "org-1", projectId: "project-1",
    });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("PUT /api/jobs updates through updateJob (scheduler, guards) and ignores a client status", async () => {
    const jobId = "00000000-0000-4000-8000-000000000005";
    mockDb.select
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: jobId, projectId: "project-1", organizationId: "org-1", jobType: "playwright" }]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ id: TEST_ID, type: "browser" }]),
        }),
      });
    (updateJob as jest.Mock).mockResolvedValue({ success: true, job: { id: jobId } });

    const response = await PUT(new Request("http://localhost/api/jobs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: jobId, name: "Nightly Job", description: "Nightly", cronSchedule: "0 * * * *",
        status: "paused", tests: [{ id: TEST_ID }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(updateJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId, cronSchedule: "0 * * * *", tests: [{ id: TEST_ID }] }),
      expect.objectContaining({ organizationId: "org-1" }),
    );
    expect((updateJob as jest.Mock).mock.calls[0][0]).not.toHaveProperty("status");
  });

  it("PUT /api/jobs keeps the stored description, guards inherited fields with updatedAt, and maps a conflict to 409", async () => {
    const jobId = "00000000-0000-4000-8000-000000000006";
    const updatedAt = new Date("2026-01-01T00:00:00.000Z");
    mockDb.select
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: jobId, projectId: "project-1", organizationId: "org-1", jobType: "playwright", cronSchedule: "5 * * * *", description: "Stored", updatedAt }]),
          }),
        }),
      })
      .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ id: TEST_ID, type: "browser" }]) }) });
    (updateJob as jest.Mock).mockResolvedValue({ success: false, message: "Job changed since you opened it — reload" });

    const response = await PUT(new Request("http://localhost/api/jobs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: jobId, name: "Nightly Job", tests: [{ id: TEST_ID }] }),
    }));

    expect(response.status).toBe(409);
    expect(updateJob).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Stored", expectedUpdatedAt: updatedAt.toISOString() }),
      expect.objectContaining({ inherited: { cronSchedule: true, description: true } }),
    );
  });

  it("PUT /api/jobs keeps the stored schedule when cronSchedule is omitted", async () => {
    const jobId = "00000000-0000-4000-8000-000000000006";
    mockDb.select
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: jobId, projectId: "project-1", organizationId: "org-1", jobType: "playwright", cronSchedule: "5 * * * *" }]),
          }),
        }),
      })
      .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ id: TEST_ID, type: "browser" }]) }) });
    (updateJob as jest.Mock).mockResolvedValue({ success: true, job: { id: jobId } });

    const response = await PUT(new Request("http://localhost/api/jobs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: jobId, name: "Nightly Job", tests: [{ id: TEST_ID }] }),
    }));

    expect(response.status).toBe(200);
    expect(updateJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId, cronSchedule: "5 * * * *" }),
      expect.objectContaining({ inherited: { cronSchedule: true, description: true } }),
    );
  });

  it("POST /api/jobs rejects a k6 job with more than one test", async () => {
    const T2 = "00000000-0000-4000-8000-0000000000a2";
    const rows = [{ id: TEST_ID, type: "performance" }, { id: T2, type: "performance" }];
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "orderBy", "limit"]) chain[method] = () => chain;
    chain.then = (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
    mockDb.select.mockReturnValue(chain);

    const response = await POST(new NextRequest("http://localhost/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Load", description: "Load", cronSchedule: "0 * * * *", jobType: "k6",
        tests: [{ id: TEST_ID }, { id: T2 }],
      }),
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("exactly one");
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  describe("POST /api/jobs input rules", () => {
    const post = (extra: object) => POST(new NextRequest("http://localhost/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "J", description: "d", cronSchedule: "0 * * * *", tests: [{ id: TEST_ID }], ...extra }),
    }));

    it("checks job:create permission before the subscription", async () => {
      mockCheckPermissionWithContext.mockReturnValue(false);
      mockSubscriptionService.blockUntilSubscribed.mockRejectedValue(new Error("Subscription required"));
      const response = await post({});
      expect(response.status).toBe(403);
      expect(mockSubscriptionService.blockUntilSubscribed).not.toHaveBeenCalled();
    });

    it.each([
      ["a blank name", { name: "   " }],
      ["a name over 255 characters", { name: "x".repeat(256) }],
      ["a description over 2000 characters", { description: "x".repeat(2001) }],
      ["more than 50 tests", { tests: Array.from({ length: 51 }, () => ({ id: TEST_ID })) }],
    ])("answers 400 for %s", async (_label, extra) => {
      const response = await post(extra);
      expect(response.status).toBe(400);
      expect(mockSubscriptionService.blockUntilSubscribed).not.toHaveBeenCalled();
    });

    it("always inserts status pending, whatever the client sends", async () => {
      const values = jest.fn(() => ({ returning: jest.fn(async () => [{ id: "j", name: "J" }]) }));
      mockDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ id: TEST_ID, type: "browser" }]) }) });
      mockDb.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
        insert: () => ({ values: (v: unknown) => (mockInsertValues(v), values()) }),
      }));
      await post({ status: "passed" });
      expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ status: "pending" }));
    });
  });

  describe("PUT /api/jobs optional fields", () => {
    it("does not require a description or a cron schedule", async () => {
      const response = await PUT(new Request("http://localhost/api/jobs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000005", name: "J", tests: [{ id: "bad" }] }),
      }));
      // Past the required-field gate it reaches the test-id check (400 with that message, not "Missing required").
      expect((await response.json()).error).toContain("valid test ID");
    });
  });

  describe("nested test ids", () => {
    // A string that is not a uuid would reach `inArray(tests.id, ...)` and fail in Postgres with a 500.
    it.each(["test-1", "not-a-uuid", "12345"])("POST /api/jobs answers 400 for the test id %s", async (id) => {
      const response = await POST(new NextRequest("http://localhost/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Nightly Job", description: "Nightly", cronSchedule: "0 * * * *", tests: [{ id }] }),
      }));

      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("valid test ID");
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it("PUT /api/jobs answers 400 for a test id that is not a uuid", async () => {
      const response = await PUT(new Request("http://localhost/api/jobs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "00000000-0000-4000-8000-000000000005",
          name: "Nightly Job",
          description: "Nightly",
          cronSchedule: "0 * * * *",
          tests: [{ id: "not-a-uuid" }],
        }),
      }));

      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("valid test ID");
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });
  });

  describe("cron and threshold validation (c10, c16)", () => {
    const body = (extra: object) => JSON.stringify({ id: "00000000-0000-4000-8000-000000000005", name: "J", description: "d", cronSchedule: "0 * * * *", tests: [{ id: TEST_ID }], ...extra });
    const post = (extra: object) => POST(new NextRequest("http://localhost/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: body(extra) }));
    const put = (extra: object) => PUT(new Request("http://localhost/api/jobs", { method: "PUT", headers: { "content-type": "application/json" }, body: body(extra) }));

    it.each(["* * * * * *", "nonsense"])("POST and PUT reject cron %j before any write", async (cronSchedule) => {
      for (const send of [post, put]) {
        const response = await send({ cronSchedule });
        expect(response.status).toBe(400);
        expect(mockDb.transaction).not.toHaveBeenCalled();
      }
    });

    it.each([2.5, 0, -1])("POST rejects failureThreshold %p", async (failureThreshold) => {
      const response = await post({ alertConfig: { enabled: false, notificationProviders: [], failureThreshold, recoveryThreshold: 1 } });
      expect(response.status).toBe(400);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });
  });
});
