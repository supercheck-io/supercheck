const mockWorkerRun = jest.fn();
const mockWorkerClose = jest.fn();
const mockWorkerOn = jest.fn();

jest.mock("bullmq", () => ({
  DelayedError: class DelayedError extends Error {},
  Worker: jest.fn().mockImplementation(() => ({
    run: mockWorkerRun,
    close: mockWorkerClose,
    on: mockWorkerOn,
  })),
}));

jest.mock("@/lib/queue", () => ({
  getRedisConnection: jest.fn(() => ({ duplicate: jest.fn() })),
  queueLogger: { error: jest.fn(), info: jest.fn() },
}));

jest.mock("@/sre/lib/background-alert-triage", () => ({
  processSreBackgroundAlertTriageJob: jest.fn(),
}));

jest.mock("@/sre/lib/feature-gates", () => ({
  isSreBackgroundAlertTriageEnabled: jest.fn(),
}));

import { DelayedError, Worker } from "bullmq";
import { processSreBackgroundAlertTriageJob } from "@/sre/lib/background-alert-triage";
import { isSreBackgroundAlertTriageEnabled } from "@/sre/lib/feature-gates";
import {
  initializeSreAlertTriageProcessor,
  ORG_LIMIT_DEFER_DELAY_MS,
  ORG_LIMIT_DEFER_WINDOW_MS,
  shutdownSreAlertTriageProcessor,
} from "./background-alert-triage-processor";

const mockWorkerConstructor = Worker as unknown as jest.Mock;
const mockIsSreBackgroundAlertTriageEnabled = isSreBackgroundAlertTriageEnabled as jest.Mock;

describe("initializeSreAlertTriageProcessor", () => {
  beforeEach(async () => {
    await shutdownSreAlertTriageProcessor();
    jest.clearAllMocks();
    mockWorkerClose.mockResolvedValue(undefined);
    mockIsSreBackgroundAlertTriageEnabled.mockReturnValue(false);
  });

  afterEach(async () => {
    await shutdownSreAlertTriageProcessor();
  });

  it("does not create a worker when background triage is disabled", async () => {
    await expect(initializeSreAlertTriageProcessor()).resolves.toBe(false);

    expect(mockWorkerConstructor).not.toHaveBeenCalled();
    expect(mockWorkerRun).not.toHaveBeenCalled();
  });

  it("resolves after starting the long-lived worker run loop", async () => {
    mockIsSreBackgroundAlertTriageEnabled.mockReturnValue(true);
    mockWorkerRun.mockReturnValue(new Promise(() => undefined));

    const result = await Promise.race([
      initializeSreAlertTriageProcessor(),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 50)),
    ]);

    expect(result).toBe(true);
    expect(mockWorkerConstructor).toHaveBeenCalledTimes(1);
    expect(mockWorkerRun).toHaveBeenCalledTimes(1);
  });

  describe("job handler", () => {
    async function getHandler() {
      mockIsSreBackgroundAlertTriageEnabled.mockReturnValue(true);
      mockWorkerRun.mockReturnValue(new Promise(() => undefined));
      await initializeSreAlertTriageProcessor();
      return mockWorkerConstructor.mock.calls[0][1] as (
        job: { data: unknown; timestamp?: number; moveToDelayed?: jest.Mock },
        token?: string,
      ) => Promise<unknown>;
    }

    it("throws on failed triage so BullMQ retries the job", async () => {
      (processSreBackgroundAlertTriageJob as jest.Mock).mockResolvedValue({ success: false, error: "SRE triage failed" });
      const handler = await getHandler();

      await expect(handler({ data: {} })).rejects.toThrow("SRE triage failed");
    });

    it("delays a job blocked by the organization run cap without using an attempt", async () => {
      const limited = { success: true, skipped: true, reason: "org_concurrency_limit" };
      (processSreBackgroundAlertTriageJob as jest.Mock).mockResolvedValue(limited);
      const handler = await getHandler();
      const moveToDelayed = jest.fn().mockResolvedValue(undefined);
      const before = Date.now();

      await expect(handler({ data: {}, timestamp: before, moveToDelayed }, "tok")).rejects.toBeInstanceOf(DelayedError);
      expect(moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "tok");
      expect(moveToDelayed.mock.calls[0][0]).toBeGreaterThanOrEqual(before + ORG_LIMIT_DEFER_DELAY_MS);
    });

    it("gives up deferring once the job is older than the defer window", async () => {
      const limited = { success: true, skipped: true, reason: "org_concurrency_limit" };
      (processSreBackgroundAlertTriageJob as jest.Mock).mockResolvedValue(limited);
      const handler = await getHandler();
      const moveToDelayed = jest.fn();

      await expect(
        handler({ data: {}, timestamp: Date.now() - ORG_LIMIT_DEFER_WINDOW_MS - 1, moveToDelayed }, "tok"),
      ).resolves.toEqual(limited);
      expect(moveToDelayed).not.toHaveBeenCalled();
    });

    it("does not throw for skipped jobs", async () => {
      const skipped = { success: true, skipped: true, reason: "already_triaged" };
      (processSreBackgroundAlertTriageJob as jest.Mock).mockResolvedValue(skipped);
      const handler = await getHandler();

      await expect(handler({ data: {} })).resolves.toEqual(skipped);
    });
  });
});
