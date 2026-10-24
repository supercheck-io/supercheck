import { getExecutionPolicy } from "@/lib/execution/execution-policy";
jest.mock("@/lib/execution/execution-policy", () => ({
  ...jest.requireActual("@/lib/execution/execution-policy"),
  getExecutionPolicy: jest.fn(async (organizationId: string) => {
    const { subscriptionService } = jest.requireMock("@/lib/services/subscription-service");
    await subscriptionService.blockUntilSubscribed(organizationId);
    await subscriptionService.requireValidPolarCustomer(organizationId);
    return { tier: "paid", priority: 0, runningCapacity: 5, queuedCapacity: 50 };
  }),
}));
jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock("@/lib/queue", () => ({
  addJobToQueue: jest.fn(),
  addK6JobToQueue: jest.fn(),
  queueLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock("@/lib/job-execution-utils", () => ({
  prepareJobTestScripts: jest.fn(),
}));
jest.mock("@/lib/location-registry", () => ({
  resolveProjectK6Location: jest.fn(),
  assertProjectSupportsBrowser: jest.fn().mockResolvedValue(undefined),
  LocationWorkloadUnavailableError: class LocationWorkloadUnavailableError extends Error {
    workload = "browser";
  },
}));
jest.mock("@/lib/services/subscription-service", () => {
  class SubscriptionAccessDeniedError extends Error {
    constructor(
      message: string,
      readonly reason: string,
    ) {
      super(message);
    }
  }
  return {
    SubscriptionAccessDeniedError,
    subscriptionService: {
      blockUntilSubscribed: jest.fn(),
      requireValidPolarCustomer: jest.fn(),
    },
  };
});
jest.mock("@/lib/services/polar-usage.service", () => ({
  polarUsageService: { shouldBlockUsage: jest.fn() },
}));

import { db } from "@/utils/db";
import {
  SubscriptionAccessDeniedError,
  subscriptionService,
} from "@/lib/services/subscription-service";
import { polarUsageService } from "@/lib/services/polar-usage.service";
import {
  assertProjectSupportsBrowser,
  resolveProjectK6Location,
} from "@/lib/location-registry";
import { processScheduledJob } from "./job-scheduler";

const scheduledJob = {
  data: {
    jobId: "job-1",
    projectId: "project-1",
    organizationId: "org-1",
  },
} as Parameters<typeof processScheduledJob>[0];

function selectRows(rows: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

describe("scheduled execution admission", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (polarUsageService.shouldBlockUsage as jest.Mock).mockResolvedValue({
      blocked: false,
    });
    (subscriptionService.blockUntilSubscribed as jest.Mock).mockResolvedValue(
      undefined,
    );
    (
      subscriptionService.requireValidPolarCustomer as jest.Mock
    ).mockResolvedValue(undefined);
  });

  it("does not create a run when subscription validation blocks execution", async () => {
    (db.select as jest.Mock).mockReturnValueOnce(
      selectRows([
        {
          id: "job-1",
          projectId: "project-1",
          organizationId: "org-1",
          jobType: "playwright",
        },
      ]),
    );
    (subscriptionService.blockUntilSubscribed as jest.Mock).mockRejectedValue(
      new SubscriptionAccessDeniedError("inactive", "subscription_required"),
    );

    (db.select as jest.Mock).mockReturnValueOnce(selectRows([]));

    await expect(processScheduledJob(scheduledJob)).resolves.toEqual({
      success: true,
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("does not create a run when the organization spending limit blocks execution", async () => {
    (db.select as jest.Mock).mockReturnValueOnce(
      selectRows([
        {
          id: "job-1",
          projectId: "project-1",
          organizationId: "org-1",
          jobType: "playwright",
        },
      ]),
    );
    (polarUsageService.shouldBlockUsage as jest.Mock).mockResolvedValue({
      blocked: true,
      reason: "Spending limit reached",
    });

    (db.select as jest.Mock).mockReturnValueOnce(selectRows([]));

    await expect(processScheduledJob(scheduledJob)).resolves.toEqual({
      success: true,
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("deduplicates a prior queued run", async () => {
    (db.select as jest.Mock)
      .mockReturnValueOnce(
        selectRows([
          {
            id: "job-1",
            projectId: "project-1",
            organizationId: "org-1",
            jobType: "playwright",
          },
        ]),
      )
      .mockReturnValueOnce(selectRows([{ id: "run-queued" }]));

    await expect(processScheduledJob(scheduledJob)).resolves.toEqual({
      success: true,
    });
    expect(db.insert).not.toHaveBeenCalled();
    expect(subscriptionService.blockUntilSubscribed).not.toHaveBeenCalled();
  });

  it("records a failed run instead of skipping silently when no location supports the workload", async () => {
    const { LocationWorkloadUnavailableError } = jest.requireMock(
      "@/lib/location-registry",
    );
    (db.select as jest.Mock)
      .mockReturnValueOnce(
        selectRows([
          {
            id: "job-1",
            projectId: "project-1",
            organizationId: "org-1",
            jobType: "playwright",
          },
        ]),
      )
      .mockReturnValueOnce(selectRows([]));
    (assertProjectSupportsBrowser as jest.Mock).mockRejectedValueOnce(
      new LocationWorkloadUnavailableError(),
    );
    const values = jest.fn().mockResolvedValue(undefined);
    (db.insert as jest.Mock).mockReturnValue({ values });

    await expect(processScheduledJob(scheduledJob)).resolves.toEqual({
      success: true,
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        status: "failed",
        trigger: "schedule",
      }),
    );
  });

  it("records a failed k6 run when no k6-capable location exists for the project", async () => {
    const { LocationWorkloadUnavailableError } = jest.requireMock(
      "@/lib/location-registry",
    );
    (db.select as jest.Mock)
      .mockReturnValueOnce(
        selectRows([
          {
            id: "job-1",
            projectId: "project-1",
            organizationId: "org-1",
            jobType: "k6",
          },
        ]),
      )
      .mockReturnValueOnce(selectRows([]));
    (resolveProjectK6Location as jest.Mock).mockRejectedValueOnce(
      new LocationWorkloadUnavailableError(),
    );
    const values = jest.fn().mockResolvedValue(undefined);
    (db.insert as jest.Mock).mockReturnValue({ values });

    await expect(processScheduledJob(scheduledJob)).resolves.toEqual({
      success: true,
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        metadata: expect.objectContaining({ executionEngine: "k6" }),
      }),
    );
  });

  it.each(["paid", "trial"] as const)("rethrows unexpected location resolution errors for %s access", async (tier) => {
    if (tier === "trial") jest.mocked(getExecutionPolicy).mockResolvedValueOnce({ tier, priority: 1, runningCapacity: 1, queuedCapacity: 10, expiresAt: new Date(Date.now() + 60_000), k6MaxVus: 5, k6RemainingVuMs: 9_000_000, playwrightRemainingMs: 1000 });
    (db.select as jest.Mock)
      .mockReturnValueOnce(
        selectRows([
          {
            id: "job-1",
            projectId: "project-1",
            organizationId: "org-1",
            jobType: "k6",
          },
        ]),
      )
      .mockReturnValueOnce(selectRows([]));
    (resolveProjectK6Location as jest.Mock).mockRejectedValueOnce(
      new Error("db down"),
    );
    await expect(processScheduledJob(scheduledJob)).rejects.toThrow("db down");
    if (tier === "trial") expect(polarUsageService.shouldBlockUsage).not.toHaveBeenCalled();
  });

  it("rethrows unexpected billing dependency errors for scheduler retry", async () => {
    (db.select as jest.Mock)
      .mockReturnValueOnce(
        selectRows([
          {
            id: "job-1",
            projectId: "project-1",
            organizationId: "org-1",
            jobType: "playwright",
          },
        ]),
      )
      .mockReturnValueOnce(selectRows([]));
    (subscriptionService.blockUntilSubscribed as jest.Mock).mockRejectedValue(
      new Error("billing database unavailable"),
    );
    (db.update as jest.Mock).mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    });

    await expect(processScheduledJob(scheduledJob)).rejects.toThrow(
      "billing database unavailable",
    );
    expect(db.insert).not.toHaveBeenCalled();
  });
});
