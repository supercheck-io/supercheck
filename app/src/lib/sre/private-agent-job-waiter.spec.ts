import { waitForPrivateAgentConnectorJob } from "./private-agent-job-waiter";

const pendingJob = {
  status: "queued" as const,
  resultHash: null,
  resultSummary: null,
  errorCode: null,
};

const completedJob = {
  status: "completed" as const,
  resultHash: "a".repeat(64),
  resultSummary: { evidence: [] },
  errorCode: null,
};

describe("waitForPrivateAgentConnectorJob", () => {
  it("waits for an asynchronous Private Agent result", async () => {
    let currentTime = 0;
    const load = jest
      .fn()
      .mockResolvedValueOnce(pendingJob)
      .mockResolvedValueOnce({ ...pendingJob, status: "running" })
      .mockResolvedValueOnce(completedJob);

    await expect(
      waitForPrivateAgentConnectorJob({
        load,
        timeoutMs: 1_000,
        pollIntervalMs: 100,
        now: () => currentTime,
        sleep: async (delayMs) => {
          currentTime += delayMs;
        },
      }),
    ).resolves.toEqual({ state: "completed", job: completedJob });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("returns pending when the bounded wait expires", async () => {
    let currentTime = 0;

    await expect(
      waitForPrivateAgentConnectorJob({
        load: async () => pendingJob,
        timeoutMs: 250,
        pollIntervalMs: 100,
        now: () => currentTime,
        sleep: async (delayMs) => {
          currentTime += delayMs;
        },
      }),
    ).resolves.toEqual({ state: "pending", job: pendingJob });
    expect(currentTime).toBe(250);
  });

  it("fails closed when the job disappears or reaches a terminal failure", async () => {
    await expect(
      waitForPrivateAgentConnectorJob({
        load: async () => null,
        timeoutMs: 0,
      }),
    ).resolves.toEqual({ state: "missing" });

    const failedJob = {
      ...pendingJob,
      status: "failed" as const,
      errorCode: "connector_failed",
    };
    await expect(
      waitForPrivateAgentConnectorJob({
        load: async () => failedJob,
        timeoutMs: 0,
      }),
    ).resolves.toEqual({ state: "failed", job: failedJob });
  });
});
