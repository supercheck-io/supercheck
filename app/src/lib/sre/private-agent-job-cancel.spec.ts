/** @jest-environment node */
const mockSet = jest.fn();
jest.mock("@/utils/db", () => ({
  db: { update: jest.fn(() => ({ set: (v: unknown) => (mockSet(v), { where: jest.fn().mockResolvedValue(undefined) }) })) },
}));

import { cancelQueuedPrivateAgentJob, requeueAbandonedPrivateAgentJob } from "./private-agent-job-cancel";

it("marks a queued job cancelled", async () => {
  await cancelQueuedPrivateAgentJob({ jobId: "j", organizationId: "o", projectId: "p" });
  expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
});

it("requeues a job it cancelled as abandoned, so an identical retry runs", async () => {
  mockSet.mockClear();
  await requeueAbandonedPrivateAgentJob({ jobId: "j", organizationId: "o", projectId: "p" });
  expect(mockSet).toHaveBeenCalledWith(
    expect.objectContaining({
      status: "queued", completedAt: null, errorCode: null, createdAt: expect.any(Date),
      leaseTokenHash: null, leaseExpiresAt: null, resultSummary: null, resultHash: null, durationMs: null, startedAt: null,
    }),
  );
});
