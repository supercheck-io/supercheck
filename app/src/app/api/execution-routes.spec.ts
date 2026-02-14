/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    query: {
      tests: {
        findFirst: jest.fn(),
      },
    },
  },
}));

jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: jest.fn(),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(),
}));

jest.mock("@/lib/queue", () => ({
  addTestToQueue: jest.fn(),
  addK6TestToQueue: jest.fn(),
  addJobToQueue: jest.fn(),
  addK6JobToQueue: jest.fn(),
}));

jest.mock("@/lib/k6-validator", () => ({
  validateK6Script: jest.fn(),
}));

jest.mock("@/lib/variable-resolver", () => ({
  resolveProjectVariables: jest.fn(),
}));

jest.mock("@/lib/job-execution-utils", () => ({
  prepareJobTestScripts: jest.fn(),
}));

jest.mock("@/lib/security/api-key-hash", () => ({
  verifyApiKey: jest.fn(),
}));

jest.mock("@/lib/api-key-rate-limiter", () => ({
  apiKeyRateLimiter: {
    checkAndIncrement: jest.fn(),
  },
  parseRateLimitConfig: jest.fn(),
  createRateLimitHeaders: jest.fn(() => ({})),
}));

jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: {
    blockUntilSubscribed: jest.fn(),
    requireValidPolarCustomer: jest.fn(),
    getOrganizationPlan: jest.fn(),
  },
  SubscriptionService: jest.fn().mockImplementation(() => ({
    blockUntilSubscribed: jest.fn().mockResolvedValue(undefined),
    requireValidPolarCustomer: jest.fn().mockResolvedValue(undefined),
    getOrganizationPlan: jest.fn().mockResolvedValue({ plan: "pro" }),
  })),
}));

import { GET as getTriggerInfo, POST as postTrigger } from "./jobs/[id]/trigger/route";
import { POST as executeSingleTest } from "./tests/[id]/execute/route";

const { db: mockDb } = jest.requireMock("@/utils/db") as {
  db: {
    select: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    query: { tests: { findFirst: jest.Mock } };
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

const {
  addTestToQueue: mockAddTestToQueue,
  addJobToQueue: mockAddJobToQueue,
} = jest.requireMock("@/lib/queue") as {
  addTestToQueue: jest.Mock;
  addJobToQueue: jest.Mock;
};

const { validateK6Script: mockValidateK6Script } = jest.requireMock(
  "@/lib/k6-validator",
) as { validateK6Script: jest.Mock };

const { resolveProjectVariables: mockResolveProjectVariables } =
  jest.requireMock("@/lib/variable-resolver") as {
    resolveProjectVariables: jest.Mock;
  };

const { prepareJobTestScripts: mockPrepareJobTestScripts } = jest.requireMock(
  "@/lib/job-execution-utils",
) as { prepareJobTestScripts: jest.Mock };

const { verifyApiKey: mockVerifyApiKey } = jest.requireMock(
  "@/lib/security/api-key-hash",
) as { verifyApiKey: jest.Mock };

const {
  apiKeyRateLimiter,
  parseRateLimitConfig: mockParseRateLimitConfig,
  createRateLimitHeaders: mockCreateRateLimitHeaders,
} = jest.requireMock("@/lib/api-key-rate-limiter") as {
  apiKeyRateLimiter: { checkAndIncrement: jest.Mock };
  parseRateLimitConfig: jest.Mock;
  createRateLimitHeaders: jest.Mock;
};

const { subscriptionService: mockSubscriptionServiceSingleton } =
  jest.requireMock("@/lib/services/subscription-service") as {
    subscriptionService: {
      blockUntilSubscribed: jest.Mock;
      requireValidPolarCustomer: jest.Mock;
      getOrganizationPlan: jest.Mock;
    };
  };

describe("Execution route regressions", () => {
  const authCtx = {
    userId: "user-1",
    organizationId: "org-1",
    project: { id: "project-1", name: "Project" },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequireAuthContext.mockResolvedValue(authCtx);
    mockIsAuthError.mockReturnValue(false);
    mockCheckPermissionWithContext.mockReturnValue(true);

    mockValidateK6Script.mockReturnValue({ valid: true, errors: [], warnings: [] });
    mockResolveProjectVariables.mockResolvedValue({ variables: {}, secrets: {} });
    mockPrepareJobTestScripts.mockResolvedValue({
      testScripts: [{ id: "test-1", name: "Test 1", script: "console.log('ok')", type: "playwright" }],
      variableResolution: { variables: {}, secrets: {} },
    });

    mockVerifyApiKey.mockReturnValue(true);
    mockParseRateLimitConfig.mockReturnValue({ enabled: true, timeWindow: 60, maxRequests: 10 });
    apiKeyRateLimiter.checkAndIncrement.mockResolvedValue({
      allowed: true,
      limit: 10,
      remaining: 9,
      resetAt: new Date(Date.now() + 60_000),
      retryAfter: 0,
    });
    mockCreateRateLimitHeaders.mockReturnValue({});

    mockSubscriptionServiceSingleton.blockUntilSubscribed.mockResolvedValue(undefined);
    mockSubscriptionServiceSingleton.requireValidPolarCustomer.mockResolvedValue(undefined);
    mockSubscriptionServiceSingleton.getOrganizationPlan.mockResolvedValue({ plan: "pro" });
  });

  it("GET /api/jobs/[id]/trigger returns 401 when auth fails", async () => {
    const authError = new Error("Authentication required");
    mockRequireAuthContext.mockRejectedValueOnce(authError);
    mockIsAuthError.mockReturnValueOnce(true);

    const request = new NextRequest("http://localhost/api/jobs/00000000-0000-4000-8000-000000000001/trigger");

    const response = await getTriggerInfo(request, {
      params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }),
    });

    expect(response.status).toBe(401);
  });

  it("POST /api/tests/[id]/execute persists and returns queue status", async () => {
    mockDb.query.tests.findFirst.mockResolvedValue({
      id: "test-1",
      type: "playwright",
      script: Buffer.from("test('smoke', async () => {})").toString("base64"),
      projectId: "project-1",
      organizationId: "org-1",
    });

    const insertValues = jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([{ id: "run-1" }]),
    });
    mockDb.insert.mockReturnValue({ values: insertValues });

    const updateSet = jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: updateSet });

    mockAddTestToQueue.mockResolvedValue({ runId: "run-1", status: "queued", position: 2 });

    const request = new NextRequest("http://localhost/api/tests/test-1/execute", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });

    const response = await executeSingleTest(request, {
      params: Promise.resolve({ id: "test-1" }),
    });

    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.status).toBe("queued");
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "queued" }),
    );
    expect(updateSet).toHaveBeenCalledWith({ status: "queued" });
  });

  it("POST /api/jobs/[id]/trigger starts queued and updates status from queue result", async () => {
    const jobId = "00000000-0000-4000-8000-000000000010";

    const apiKeySelect = {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([
          {
            id: "apikey-1",
            name: "key-1",
            key: "hashed-key",
            enabled: true,
            expiresAt: null,
            jobId,
            userId: "user-1",
            lastRequest: null,
            requestCount: 0,
            rateLimitEnabled: true,
            rateLimitTimeWindow: 60,
            rateLimitMax: 10,
          },
        ]),
      }),
    };

    const jobSelect = {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([
            {
              id: jobId,
              name: "Nightly",
              status: "idle",
              createdByUserId: "user-1",
              organizationId: "org-1",
              projectId: "project-1",
              jobType: "playwright",
            },
          ]),
        }),
      }),
    };

    mockDb.select
      .mockReturnValueOnce(apiKeySelect)
      .mockReturnValueOnce(jobSelect);

    const insertValues = jest.fn().mockResolvedValue(undefined);
    mockDb.insert.mockReturnValue({ values: insertValues });

    const updateSet = jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: updateSet });

    mockAddJobToQueue.mockResolvedValue({ status: "queued", position: 3 });

    const request = new NextRequest(`http://localhost/api/jobs/${jobId}/trigger`, {
      method: "POST",
      headers: {
        authorization: "Bearer supercheck_api_key_123456789",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const response = await postTrigger(request, {
      params: Promise.resolve({ id: jobId }),
    });

    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "queued", jobId }),
    );
    expect(updateSet).toHaveBeenCalledWith({ status: "queued" });
  });
});
