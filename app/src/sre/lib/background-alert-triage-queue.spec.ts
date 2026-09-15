jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: "queued-job" }),
    on: jest.fn(),
  })),
}));

jest.mock("@/lib/queue", () => ({
  getRedisConnection: jest.fn(() => ({ duplicate: jest.fn() })),
  queueLogger: { error: jest.fn(), info: jest.fn() },
}));

jest.mock("@/sre/lib/feature-gates", () => ({
  isSreBackgroundAlertTriageEnabled: jest.fn(),
}));

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
  },
}));

import { Queue } from "bullmq";
import { isSreBackgroundAlertTriageEnabled } from "@/sre/lib/feature-gates";
import { db } from "@/utils/db";
import { enqueueSreAlertTriageJob } from "./background-alert-triage-queue";

const mockQueueConstructor = Queue as unknown as jest.Mock;
const mockIsSreBackgroundAlertTriageEnabled = isSreBackgroundAlertTriageEnabled as jest.Mock;
const mockDb = db as jest.Mocked<typeof db>;
const { queueLogger: mockQueueLogger } = jest.requireMock("@/lib/queue") as {
  queueLogger: { error: jest.Mock; info: jest.Mock };
};

function selectRows(rows: unknown[]) {
  const builder = {
    from: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
  };
  builder.from.mockReturnValue(builder);
  builder.leftJoin.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  builder.limit.mockResolvedValue(rows);
  return builder;
}

function mockAlertRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "018f0000-0000-7000-8000-000000000001",
    status: "sent",
    type: "monitor_failure",
    monitorId: "018f0000-0000-7000-8000-000000000011",
    jobId: null,
    deliveryMetadata: null,
    monitorOrganizationId: "018f0000-0000-7000-8000-000000000002",
    monitorProjectId: "018f0000-0000-7000-8000-000000000003",
    jobOrganizationId: null,
    jobProjectId: null,
    ...overrides,
  };
}

describe("enqueueSreAlertTriageJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSreBackgroundAlertTriageEnabled.mockReturnValue(false);
  });

  it("does not create a queue when background triage is disabled", async () => {
    const result = await enqueueSreAlertTriageJob({ alertHistoryId: "018f0000-0000-7000-8000-000000000001" });

    expect(result).toBeNull();
    expect(mockQueueConstructor).not.toHaveBeenCalled();
  });

  it("does not enqueue invalid alert IDs", async () => {
    mockIsSreBackgroundAlertTriageEnabled.mockReturnValue(true);

    const result = await enqueueSreAlertTriageJob({ alertHistoryId: "not-a-uuid" });

    expect(result).toBeNull();
    expect(mockQueueConstructor).not.toHaveBeenCalled();
  });

  it("enqueues a deterministic triage job when enabled", async () => {
    mockIsSreBackgroundAlertTriageEnabled.mockReturnValue(true);
    const alertHistoryId = "018f0000-0000-7000-8000-000000000001";
    mockDb.select
      .mockReturnValueOnce(selectRows([mockAlertRow()]) as never)
      .mockReturnValueOnce(selectRows([]) as never);

    await enqueueSreAlertTriageJob({ alertHistoryId });

    const queue = mockQueueConstructor.mock.results[0].value;
    expect(queue.add).toHaveBeenCalledWith("triage-alert-history", { alertHistoryId }, {
        jobId: `sre-alert-triage-${alertHistoryId}`,
    });
  });

  it("skips enqueueing alerts that already have a triage run in the database", async () => {
    mockIsSreBackgroundAlertTriageEnabled.mockReturnValue(true);
    const alertHistoryId = "018f0000-0000-7000-8000-000000000001";
    mockDb.select
      .mockReturnValueOnce(selectRows([mockAlertRow()]) as never)
      .mockReturnValueOnce(selectRows([{
        alertTriageRunId: "018f0000-0000-7000-8000-000000000021",
        incidentTriageRunId: null,
      }]) as never);

    const result = await enqueueSreAlertTriageJob({ alertHistoryId });

    expect(result).toBeNull();
    expect(mockQueueConstructor).not.toHaveBeenCalled();
    expect(mockQueueLogger.info).toHaveBeenCalledWith(
      {
        event: "sre_alert_triage_enqueue_skipped",
        alertHistoryId,
        reason: "already_triaged",
      },
      "SRE alert triage enqueue skipped"
    );
  });

  it("skips non-sent alerts before they reach the background queue", async () => {
    mockIsSreBackgroundAlertTriageEnabled.mockReturnValue(true);
    const alertHistoryId = "018f0000-0000-7000-8000-000000000001";
    mockDb.select.mockReturnValueOnce(selectRows([mockAlertRow({ status: "failed" })]) as never);

    const result = await enqueueSreAlertTriageJob({ alertHistoryId });

    expect(result).toBeNull();
    expect(mockQueueConstructor).not.toHaveBeenCalled();
    expect(mockQueueLogger.info).toHaveBeenCalledWith(
      {
        event: "sre_alert_triage_enqueue_skipped",
        alertHistoryId,
        reason: "non_sent_alert",
      },
      "SRE alert triage enqueue skipped"
    );
  });
});
