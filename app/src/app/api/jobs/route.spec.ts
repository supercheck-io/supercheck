/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    transaction: jest.fn(),
  },
}));

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

import { GET, POST, PUT } from "./route";

const { db: mockDb } = jest.requireMock("@/utils/db") as {
  db: {
    select: jest.Mock;
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

  it("POST /api/jobs rejects unauthorized notification provider IDs before DB transaction", async () => {
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
        tests: [{ id: "test-1" }],
        alertConfig: {
          enabled: true,
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

  it("POST /api/jobs rejects duplicate test IDs", async () => {
    const request = new NextRequest("http://localhost/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Nightly Job",
        description: "Nightly",
        cronSchedule: "0 * * * *",
        tests: [{ id: "test-1" }, { id: "test-1" }],
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
              id: "job-1",
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
        id: "job-1",
        name: "Nightly Job",
        description: "Nightly",
        cronSchedule: "0 * * * *",
        jobType: "k6",
        tests: [{ id: "test-1" }],
      }),
    });

    const response = await PUT(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Job type cannot be changed");
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});
