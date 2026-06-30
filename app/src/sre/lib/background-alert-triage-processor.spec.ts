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
});
