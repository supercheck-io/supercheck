/** @jest-environment node */
const mockSet = jest.fn();
jest.mock("@/utils/db", () => ({
  db: { update: jest.fn(() => ({ set: (v: unknown) => (mockSet(v), { where: jest.fn().mockResolvedValue(undefined) }) })) },
}));

import { cancelQueuedPrivateAgentJob } from "./private-agent-job-cancel";

it("marks a queued job cancelled", async () => {
  await cancelQueuedPrivateAgentJob({ jobId: "j", organizationId: "o", projectId: "p" });
  expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
});
