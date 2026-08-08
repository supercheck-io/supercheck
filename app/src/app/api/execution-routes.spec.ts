/** @jest-environment node */

import { NextRequest } from "next/server";
import { ExecutionQueueError } from "@/lib/execution-errors";

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

jest.mock("@/lib/playwright-validator", () => ({
  playwrightValidationService: {
    validateCode: jest.fn(),
  },
}));

jest.mock("@/lib/audit-logger", () => ({
  logAuditEvent: jest.fn(),
}));

jest.mock("@/lib/k6-validator", () => ({
  isK6Script: jest.fn(),
  validateK6Script: jest.fn(),
}));

jest.mock("@/lib/variable-resolver", () => ({
  resolveProjectVariables: jest.fn(),
  extractVariableNames: jest.fn(),
}));

jest.mock("@/lib/job-execution-utils", () => ({
  prepareJobTestScripts: jest.fn(),
}));

jest.mock("@/lib/security/api-key-hash", () => ({
  hashApiKey: jest.fn(),
}));

jest.mock("@/lib/execution-rate-limiter", () => ({
  checkExecutionRateLimit: jest.fn().mockResolvedValue({
    allowed: true,
    retryAfter: 1,
  }),
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

jest.mock("@/lib/services/polar-usage.service", () => ({
  polarUsageService: {
    shouldBlockUsage: jest.fn().mockResolvedValue({ blocked: false }),
  },
}));

jest.mock("@/lib/location-registry", () => ({
  normalizeK6Location: jest.fn().mockResolvedValue("local"),
  resolveProjectK6Location: jest.fn().mockResolvedValue("local"),
  getAllEnabledLocationCodes: jest.fn().mockResolvedValue(["local"]),
  getFirstDefaultLocationCode: jest.fn().mockResolvedValue("local"),
}));

import {
  GET as getTriggerInfo,
  POST as postTrigger,
} from "./jobs/[id]/trigger/route";
import { POST as executePlaygroundTest } from "./test/route";
import { POST as executeSingleTest } from "./tests/[id]/execute/route";
import { POST as executeJob } from "./jobs/run/route";

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

const { playwrightValidationService: mockPlaywrightValidationService } =
  jest.requireMock("@/lib/playwright-validator") as {
    playwrightValidationService: { validateCode: jest.Mock };
  };

const { logAuditEvent: mockLogAuditEvent } = jest.requireMock(
  "@/lib/audit-logger",
) as { logAuditEvent: jest.Mock };

const { isK6Script: mockIsK6Script, validateK6Script: mockValidateK6Script } =
  jest.requireMock("@/lib/k6-validator") as {
    isK6Script: jest.Mock;
    validateK6Script: jest.Mock;
  };

const {
  resolveProjectVariables: mockResolveProjectVariables,
  extractVariableNames: mockExtractVariableNames,
} = jest.requireMock("@/lib/variable-resolver") as {
  resolveProjectVariables: jest.Mock;
  extractVariableNames: jest.Mock;
};

const { prepareJobTestScripts: mockPrepareJobTestScripts } = jest.requireMock(
  "@/lib/job-execution-utils",
) as { prepareJobTestScripts: jest.Mock };

const { hashApiKey: mockHashApiKey } = jest.requireMock(
  "@/lib/security/api-key-hash",
) as { hashApiKey: jest.Mock };

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
const { polarUsageService: mockPolarUsageService } =
  jest.requireMock("@/lib/services/polar-usage.service") as {
    polarUsageService: {
      shouldBlockUsage: jest.Mock;
    };
  };

const { checkExecutionRateLimit: mockCheckExecutionRateLimit } =
  jest.requireMock("@/lib/execution-rate-limiter") as {
    checkExecutionRateLimit: jest.Mock;
  };

describe("Execution route regressions", () => {
  const authCtx = {
    userId: "user-1",
    organizationId: "org-1",
    project: { id: "project-1", name: "Project" },
    isCliAuth: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequireAuthContext.mockResolvedValue(authCtx);
    mockIsAuthError.mockReturnValue(false);
    mockCheckPermissionWithContext.mockReturnValue(true);

    mockPlaywrightValidationService.validateCode.mockReturnValue({
      valid: true,
    });
    mockLogAuditEvent.mockResolvedValue(undefined);
    mockIsK6Script.mockReturnValue(false);
    mockValidateK6Script.mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
    });
    mockResolveProjectVariables.mockResolvedValue({
      variables: {},
      secrets: {},
      files: {},
      errors: [],
    });
    mockExtractVariableNames.mockReturnValue([]);
    mockPrepareJobTestScripts.mockResolvedValue({
      testScripts: [{ id: "test-1", name: "Test 1", script: "console.log('ok')", type: "playwright" }],
      variableResolution: { variables: {}, secrets: {} },
    });

    mockHashApiKey.mockReturnValue("hashed-key");
    mockParseRateLimitConfig.mockReturnValue({ enabled: true, timeWindow: 60, maxRequests: 10 });
    apiKeyRateLimiter.checkAndIncrement.mockResolvedValue({
      allowed: true,
      limit: 10,
      remaining: 9,
      resetAt: new Date(Date.now() + 60_000),
      retryAfter: 0,
    });
    mockCreateRateLimitHeaders.mockReturnValue({});

    mockSubscriptionServiceSingleton.blockUntilSubscribed.mockResolvedValue(
      undefined,
    );
    mockSubscriptionServiceSingleton.requireValidPolarCustomer.mockResolvedValue(
      undefined,
    );
    mockSubscriptionServiceSingleton.getOrganizationPlan.mockResolvedValue({
      plan: "pro",
    });
    mockPolarUsageService.shouldBlockUsage.mockResolvedValue({
      blocked: false,
    });
    mockCheckExecutionRateLimit.mockResolvedValue({
      allowed: true,
      retryAfter: 0,
    });
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

  it("rejects cross-origin browser execution requests", async () => {
    const playgroundResponse = await executePlaygroundTest(
      new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({ script: "test('smoke', async () => {})" }),
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
      }),
    );
    const savedTestResponse = await executeSingleTest(
      new NextRequest("http://localhost/api/tests/test-1/execute", {
        method: "POST",
        body: JSON.stringify({}),
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
      }),
      { params: Promise.resolve({ id: "test-1" }) },
    );
    const jobResponse = await executeJob(
      new NextRequest("http://localhost/api/jobs/run", {
        method: "POST",
        body: JSON.stringify({ trigger: "manual" }),
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
      }),
    );

    expect(playgroundResponse.status).toBe(403);
    expect(savedTestResponse.status).toBe(403);
    expect(jobResponse.status).toBe(403);
    expect(mockCheckExecutionRateLimit).not.toHaveBeenCalled();
  });

  it("allows origin-less authenticated CLI calls to reach job validation", async () => {
    mockRequireAuthContext.mockResolvedValueOnce({
      ...authCtx,
      isCliAuth: true,
    });

    const response = await executeJob(
      new NextRequest("http://localhost/api/jobs/run", {
        method: "POST",
        body: JSON.stringify({ trigger: "invalid" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Invalid trigger value"),
    });
  });

  it("rejects a non-string playground script before validation", async () => {
    const response = await executePlaygroundTest(
      new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({ script: { source: "unexpected" } }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPlaywrightValidationService.validateCode).not.toHaveBeenCalled();
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
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
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

	  it("POST /api/tests/[id]/execute returns a billing block payload before queueing", async () => {
	    mockPolarUsageService.shouldBlockUsage.mockResolvedValue({
	      blocked: true,
	      reason: "Monthly spending limit of $320.00 reached. Current spending: $320.76.",
	    });

	    const request = new NextRequest("http://localhost/api/tests/test-1/execute", {
	      method: "POST",
	      body: JSON.stringify({}),
	      headers: {
	        "content-type": "application/json",
	        origin: "http://localhost",
	      },
	    });

	    const response = await executeSingleTest(request, {
	      params: Promise.resolve({ id: "test-1" }),
	    });

	    const json = await response.json();

	    expect(response.status).toBe(402);
	    expect(json).toEqual({
	      error: "Monthly spending limit of $320.00 reached. Current spending: $320.76.",
	      code: "BILLING_BLOCKED",
	      blocked: true,
	    });
	    expect(mockDb.query.tests.findFirst).not.toHaveBeenCalled();
	    expect(mockAddTestToQueue).not.toHaveBeenCalled();
	  });

  it("POST /api/tests/[id]/execute returns 503 when admission is unavailable", async () => {
    mockCheckExecutionRateLimit.mockResolvedValue({
      allowed: false,
      retryAfter: 60,
      reason: "unavailable",
    });

    const response = await executeSingleTest(
      new NextRequest("http://localhost/api/tests/test-1/execute", {
        method: "POST",
        body: JSON.stringify({}),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
      }),
      { params: Promise.resolve({ id: "test-1" }) },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "EXECUTION_ADMISSION_UNAVAILABLE",
    });
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockAddTestToQueue).not.toHaveBeenCalled();
  });

  it("POST /api/test returns 503 before creating a run when admission is unavailable", async () => {
    mockCheckExecutionRateLimit.mockResolvedValue({
      allowed: false,
      retryAfter: 60,
      reason: "unavailable",
    });

    const response = await executePlaygroundTest(
      new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({ script: "test('smoke', async () => {})" }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "EXECUTION_ADMISSION_UNAVAILABLE",
    });
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockAddTestToQueue).not.toHaveBeenCalled();
  });

  it("POST /api/test finalizes the run when queue admission fails", async () => {
    mockDb.insert.mockReturnValue({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([{ id: "playground-rejected" }]),
      }),
    });
    const updateSet = jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: updateSet });
    mockAddTestToQueue.mockRejectedValue(
      new ExecutionQueueError(
        "capacity_unavailable",
        "capacity backend offline",
      ),
    );

    const response = await executePlaygroundTest(
      new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({ script: "test('smoke', async () => {})" }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
      }),
    );

    expect(response.status).toBe(503);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        errorDetails: "Execution capacity service temporarily unavailable",
      }),
    );
  });

  it("POST /api/test keeps an admitted run successful when audit logging fails", async () => {
    mockDb.insert.mockReturnValue({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([{ id: "playground-admitted" }]),
      }),
    });
    const updateSet = jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: updateSet });
    mockAddTestToQueue.mockResolvedValue({
      runId: "playground-admitted",
      status: "queued",
      position: 1,
    });
    mockLogAuditEvent.mockRejectedValue(new Error("audit unavailable"));

    const response = await executePlaygroundTest(
      new NextRequest("http://localhost/api/test", {
        method: "POST",
        body: JSON.stringify({ script: "test('smoke', async () => {})" }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      runId: "playground-admitted",
    });
    expect(updateSet).toHaveBeenCalledWith({ status: "queued" });
    expect(updateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("POST /api/tests/[id]/execute finalizes the run when queue admission fails", async () => {
    mockDb.query.tests.findFirst.mockResolvedValue({
      id: "test-1",
      type: "playwright",
      script: Buffer.from("test('smoke', async () => {})").toString("base64"),
      projectId: "project-1",
      organizationId: "org-1",
    });

    mockDb.insert.mockReturnValue({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([{ id: "run-rejected" }]),
      }),
    });
    const updateSet = jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    });
    mockDb.update.mockReturnValue({ set: updateSet });
    mockAddTestToQueue.mockRejectedValue(
      new ExecutionQueueError(
        "capacity_unavailable",
        "capacity backend offline",
      ),
    );

    const response = await executeSingleTest(
      new NextRequest("http://localhost/api/tests/test-1/execute", {
        method: "POST",
        body: JSON.stringify({}),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
      }),
      { params: Promise.resolve({ id: "test-1" }) },
    );

    expect(response.status).toBe(503);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        errorDetails: "Execution capacity service temporarily unavailable",
      }),
    );
  });

  it("POST /api/jobs/[id]/trigger starts queued and updates status from queue result", async () => {
    const jobId = "00000000-0000-4000-8000-000000000010";

    const apiKeySelect = {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{
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
          }]),
        }),
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
