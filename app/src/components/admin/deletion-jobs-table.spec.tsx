import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { DeletionJobsTable } from "./deletion-jobs-table";

const mutate = jest.fn();
const base = { scope: "job", organizationId: null, cursor: {}, nextAttemptAt: new Date().toISOString(), heartbeatAt: null, startedAt: null, createdAt: new Date(Date.now() - 3 * 3600_000).toISOString() };
const jobs = [
  { ...base, id: "d-failed", targetId: "target-failed", state: "failed", phase: "runs", attempts: 8, lastError: "Could not delete job run storage; will retry" },
  { ...base, id: "d-running", targetId: "target-running", state: "running", phase: "children", attempts: 0, lastError: null },
];

jest.mock("@/hooks/use-deletion-jobs", () => ({
  useAdminDeletionJobs: () => ({ jobs, isLoading: false, refetch: jest.fn() }),
  useRetryDeletionJob: () => ({ mutate, isPending: false }),
}));

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

it("shows state, attempts and last error, and offers Retry only for a failed purge", async () => {
  render(<DeletionJobsTable />);
  expect(await screen.findByText("Could not delete job run storage; will retry")).toBeInTheDocument();
  expect(screen.getAllByText("3 hours")).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: /Retry deletion/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Retry deletion target-failed" }));
  expect(mutate).toHaveBeenCalledWith("d-failed", expect.any(Object));
});
