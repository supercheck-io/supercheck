jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: "queued-job" }),
    on: jest.fn(),
  })),
}));

jest.mock("@/lib/queue", () => ({
  getRedisConnection: jest.fn(() => ({ duplicate: jest.fn() })),
  queueLogger: { error: jest.fn() },
}));

jest.mock("@/sre/lib/feature-gates", () => ({
  isSreBackgroundAlertTriageEnabled: jest.fn(),
}));

import { Queue } from "bullmq";
import { isSreBackgroundAlertTriageEnabled } from "@/sre/lib/feature-gates";
import { enqueueSreAlertTriageJob } from "./background-alert-triage-queue";

const mockQueueConstructor = Queue as unknown as jest.Mock;
const mockIsSreBackgroundAlertTriageEnabled = isSreBackgroundAlertTriageEnabled as jest.Mock;

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

    await enqueueSreAlertTriageJob({ alertHistoryId });

    const queue = mockQueueConstructor.mock.results[0].value;
    expect(queue.add).toHaveBeenCalledWith("triage-alert-history", { alertHistoryId }, {
      jobId: `sre-alert-triage:${alertHistoryId}`,
    });
  });
});
