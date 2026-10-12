const mockWorkerRun = jest.fn();
const mockWorkerClose = jest.fn();
const mockWorkerOn = jest.fn();

jest.mock("bullmq", () => ({
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

import { Worker } from "bullmq";
import { processSreBackgroundAlertTriageJob } from "@/sre/lib/background-alert-triage";
import { isSreBackgroundAlertTriageEnabled } from "@/sre/lib/feature-gates";
import { initializeSreAlertTriageProcessor, shutdownSreAlertTriageProcessor } from "./background-alert-triage-processor";

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
      return mockWorkerConstructor.mock.calls[0][1] as (job: { data: unknown }) => Promise<unknown>;
    }

    it("throws on failed triage so BullMQ retries the job", async () => {
      (processSreBackgroundAlertTriageJob as jest.Mock).mockResolvedValue({ success: false, error: "SRE triage failed" });
      const handler = await getHandler();

      await expect(handler({ data: {} })).rejects.toThrow("SRE triage failed");
    });

    it("does not throw for skipped jobs", async () => {
      const skipped = { success: true, skipped: true, reason: "already_triaged" };
      (processSreBackgroundAlertTriageJob as jest.Mock).mockResolvedValue(skipped);
      const handler = await getHandler();

      await expect(handler({ data: {} })).resolves.toEqual(skipped);
    });
  });
});
