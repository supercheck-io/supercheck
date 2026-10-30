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
jest.mock("@/lib/execution-api-responses", () => ({
  getSafeExecutionQueueErrorDetails: jest.fn(() => "Failed to queue execution"),
}));
jest.mock("@/lib/job-scheduler", () => ({ deleteScheduledJob: jest.fn().mockResolvedValue(true) }));
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
import { deleteScheduledJob } from "@/lib/job-scheduler";

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
    (db.update as jest.Mock).mockReturnValue({
      set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
    });
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

  it("records a blocked run when subscription validation blocks the tick", async () => {
    (db.select as jest.Mock).mockReturnValueOnce(
      selectRows([
        {
          id: "job-1",
          projectId: "project-1",
          organizationId: "org-1",
          jobType: "playwright",
          cronSchedule: "*/5 * * * *",
        },
      ]),
    )
      .mockReturnValueOnce(selectRows([{ status: "active" }]));
    (subscriptionService.blockUntilSubscribed as jest.Mock).mockRejectedValue(
      new SubscriptionAccessDeniedError("inactive", "subscription_required"),
    );

    (db.select as jest.Mock).mockReturnValueOnce(selectRows([]));
    const values = jest.fn().mockResolvedValue(undefined);
    (db.insert as jest.Mock).mockReturnValue({ values });

    await expect(processScheduledJob(scheduledJob)).resolves.toEqual({
      success: true,
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ status: "blocked", trigger: "schedule", errorDetails: "inactive" }),
    );
  });

  it("records a blocked run when the organization spending limit blocks the tick", async () => {
    (db.select as jest.Mock).mockReturnValueOnce(
      selectRows([
        {
          id: "job-1",
          projectId: "project-1",
          organizationId: "org-1",
          jobType: "playwright",
          cronSchedule: "*/5 * * * *",
        },
      ]),
    )
      .mockReturnValueOnce(selectRows([{ status: "active" }]));
    (polarUsageService.shouldBlockUsage as jest.Mock).mockResolvedValue({
      blocked: true,
      reason: "Spending limit reached",
    });

    (db.select as jest.Mock).mockReturnValueOnce(selectRows([]));
    const values = jest.fn().mockResolvedValue(undefined);
    (db.insert as jest.Mock).mockReturnValue({ values });

    await expect(processScheduledJob(scheduledJob)).resolves.toEqual({
      success: true,
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ status: "blocked", errorDetails: "Spending limit reached" }),
    );
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
            cronSchedule: "*/5 * * * *",
          },
        ]),
      )
      .mockReturnValueOnce(selectRows([{ status: "active" }]))
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
            cronSchedule: "*/5 * * * *",
          },
        ]),
      )
      .mockReturnValueOnce(selectRows([{ status: "active" }]))
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
            cronSchedule: "*/5 * * * *",
          },
        ]),
      )
      .mockReturnValueOnce(selectRows([{ status: "active" }]))
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
            cronSchedule: "*/5 * * * *",
          },
        ]),
      )
      .mockReturnValueOnce(selectRows([{ status: "active" }]))
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
            cronSchedule: "*/5 * * * *",
          },
        ]),
      )
      .mockReturnValueOnce(selectRows([{ status: "active" }]))
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

describe("scheduled job bookkeeping", () => {
  const jobRow = {
    id: "job-1",
    projectId: "project-1",
    organizationId: "org-1",
    jobType: "playwright",
    cronSchedule: "*/5 * * * *",
    status: "idle",
  };
  const sets: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    jest.clearAllMocks();
    sets.length = 0;
    (polarUsageService.shouldBlockUsage as jest.Mock).mockResolvedValue({ blocked: false });
    (subscriptionService.blockUntilSubscribed as jest.Mock).mockResolvedValue(undefined);
    (subscriptionService.requireValidPolarCustomer as jest.Mock).mockResolvedValue(undefined);
    (db.update as jest.Mock).mockReturnValue({
      set: jest.fn((values: Record<string, unknown>) => {
        sets.push(values);
        return { where: jest.fn().mockResolvedValue(undefined) };
      }),
    });
    (db.insert as jest.Mock).mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) });
  });

  it("advances nextRunAt when the tick is skipped because a run is still active", async () => {
    (db.select as jest.Mock)
      .mockReturnValueOnce(selectRows([jobRow]))
      .mockReturnValueOnce(selectRows([{ status: "active" }]))
      .mockReturnValueOnce(selectRows([{ id: "run-active" }]));
    await processScheduledJob(scheduledJob);
    expect(sets).toContainEqual(expect.objectContaining({ nextRunAt: expect.any(Date) }));
  });

  it("restores the job status when enqueueing fails", async () => {
    const { prepareJobTestScripts } = jest.requireMock("@/lib/job-execution-utils");
    prepareJobTestScripts.mockResolvedValue({
      testScripts: [{ id: "t1", name: "T", script: "x", type: "browser" }],
      variableResolution: { variables: {}, secrets: {}, files: {} },
    });
    (db.select as jest.Mock)
      .mockReturnValueOnce(selectRows([jobRow]))
      .mockReturnValueOnce(selectRows([{ status: "active" }]))
      .mockReturnValueOnce(selectRows([]));
    const { addJobToQueue } = jest.requireMock("@/lib/queue");
    addJobToQueue.mockRejectedValue(new Error("queue down"));
    await expect(processScheduledJob(scheduledJob)).resolves.toEqual({ success: false });
    expect(sets).toContainEqual({ status: "idle" });
  });

  it("removes the repeatable and creates no run when the project is soft-deleted", async () => {
    (db.select as jest.Mock)
      .mockReturnValueOnce(selectRows([jobRow]))
      .mockReturnValueOnce(selectRows([{ status: "deleted" }]));
    await expect(processScheduledJob(scheduledJob)).resolves.toEqual({ success: true });
    expect(deleteScheduledJob).toHaveBeenCalledWith("job-1");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("removes the repeatable when the job no longer has a cron schedule", async () => {
    (db.select as jest.Mock)
      .mockReturnValueOnce(selectRows([{ ...jobRow, cronSchedule: null }]))
      .mockReturnValueOnce(selectRows([{ status: "active" }]));
    await processScheduledJob(scheduledJob);
    expect(deleteScheduledJob).toHaveBeenCalledWith("job-1");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("expires stale queued runs before the overlap check", async () => {
    (db.select as jest.Mock)
      .mockReturnValueOnce(selectRows([jobRow]))
      .mockReturnValueOnce(selectRows([{ status: "active" }]))
      .mockReturnValueOnce(selectRows([{ id: "run-active" }]));
    await processScheduledJob(scheduledJob);
    expect(sets).toContainEqual(expect.objectContaining({ status: "error", errorDetails: expect.any(String) }));
  });

  it("does not fail the job or other runs when no run was inserted", async () => {
    (db.select as jest.Mock)
      .mockReturnValueOnce(selectRows([jobRow]))
      .mockReturnValueOnce(selectRows([{ status: "active" }]))
      .mockReturnValueOnce(selectRows([]));
    (subscriptionService.blockUntilSubscribed as jest.Mock).mockRejectedValue(new Error("db down"));
    await expect(processScheduledJob(scheduledJob)).rejects.toThrow("db down");
    expect(sets).not.toContainEqual({ status: "error" });
  });

  it("only errors this tick's run and writes a safe message when post-insert work throws", async () => {
    const { prepareJobTestScripts } = jest.requireMock("@/lib/job-execution-utils");
    prepareJobTestScripts.mockRejectedValue(new Error("secret internal detail"));
    (db.select as jest.Mock)
      .mockReturnValueOnce(selectRows([jobRow]))
      .mockReturnValueOnce(selectRows([{ status: "active" }]))
      .mockReturnValueOnce(selectRows([]));
    await processScheduledJob(scheduledJob);
    expect(JSON.stringify(sets)).not.toContain("secret internal detail");
  });
});
