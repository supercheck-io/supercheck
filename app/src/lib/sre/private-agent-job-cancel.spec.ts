/** @jest-environment node */
// Real SQL semantics are proven in src/db/private-agent-job-waiters.db.spec.ts; this covers the helper's wiring.
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

import { joinPrivateAgentJob, releasePrivateAgentJobWaiter } from "./private-agent-job-cancel";

const ref = { jobId: "j", organizationId: "o", projectId: "p" };

it("joining updates waiters and the abandoned-job reset fields in one statement", async () => {
  await joinPrivateAgentJob(ref);
  expect(mockSet).toHaveBeenCalledTimes(1);
  expect(mockSet).toHaveBeenCalledWith(
    expect.objectContaining({
      status: expect.anything(), waiters: expect.anything(), createdAt: expect.anything(),
      leaseTokenHash: expect.anything(), leaseExpiresAt: expect.anything(), resultSummary: expect.anything(),
      resultHash: expect.anything(), durationMs: expect.anything(), startedAt: expect.anything(),
      completedAt: expect.anything(), errorCode: expect.anything(), cancelRequestedAt: expect.anything(),
    }),
  );
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
