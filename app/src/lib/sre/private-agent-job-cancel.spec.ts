/** @jest-environment node */
const mockSet = jest.fn();
let mockReturning: unknown[] = [];
jest.mock("@/utils/db", () => ({
  db: {
    update: jest.fn(() => ({
      set: (v: unknown) => (
        mockSet(v),
        { where: jest.fn(() => Object.assign(Promise.resolve(undefined), { returning: async () => mockReturning })) }
      ),
    })),
  },
}));

import {
  registerPrivateAgentJobWaiter,
  releasePrivateAgentJobWaiter,
  requeueAbandonedPrivateAgentJob,
} from "./private-agent-job-cancel";

const ref = { jobId: "j", organizationId: "o", projectId: "p" };

it("a joining caller increments the waiter count", async () => {
  await registerPrivateAgentJobWaiter(ref);
  expect(mockSet).toHaveBeenCalledWith({ waiters: expect.anything() });
});

it("reports cancelled only when the row came back cancelled as abandoned", async () => {
  mockReturning = [{ status: "cancelled", errorCode: "wait_abandoned" }];
  await expect(releasePrivateAgentJobWaiter(ref)).resolves.toBe(true);
  mockReturning = [{ status: "queued", errorCode: null }]; // another waiter remains
  await expect(releasePrivateAgentJobWaiter(ref)).resolves.toBe(false);
  mockReturning = [{ status: "leased", errorCode: null }]; // an agent already took it
  await expect(releasePrivateAgentJobWaiter(ref)).resolves.toBe(false);
  mockReturning = [];
  await expect(releasePrivateAgentJobWaiter(ref)).resolves.toBe(false);
});

it("requeues a job it cancelled as abandoned, so an identical retry runs", async () => {
  mockSet.mockClear();
  await requeueAbandonedPrivateAgentJob(ref);
  expect(mockSet).toHaveBeenCalledWith(
    expect.objectContaining({
      status: "queued", waiters: 0, completedAt: null, errorCode: null, createdAt: expect.any(Date),
      leaseTokenHash: null, leaseExpiresAt: null, resultSummary: null, resultHash: null, durationMs: null, startedAt: null,
    }),
  );
});
