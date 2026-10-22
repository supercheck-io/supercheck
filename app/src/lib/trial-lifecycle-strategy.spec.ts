/** @jest-environment node */
const mockWhere = jest.fn();
const mockEndExpiredTrials = jest.fn();
jest.mock("@/utils/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: (...args: unknown[]) => mockWhere(...args) }),
    }),
  },
}));
jest.mock("@/lib/s3-cleanup", () => ({ createS3CleanupService: () => ({}) }));
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => false }));
jest.mock("@/lib/monitor-aggregation-service", () => ({
  monitorAggregationService: {},
}));
jest.mock("@/lib/execution/trial-lifecycle", () => ({
  endExpiredTrials: (...args: unknown[]) => mockEndExpiredTrials(...args),
}));
import { TrialLifecycleStrategy } from "./data-lifecycle-service";

const strategy = () =>
  new TrialLifecycleStrategy({
    entityType: "trial_lifecycle",
    cronSchedule: "*/15 * * * *",
    enabled: true,
  });

beforeEach(() => jest.clearAllMocks());

it("ends expired trials and reports what changed", async () => {
  mockEndExpiredTrials.mockResolvedValue({
    organizations: 2,
    monitorsPaused: 7,
    statusPagesArchived: 3,
  });
  await expect(strategy().execute()).resolves.toMatchObject({
    success: true,
    entityType: "trial_lifecycle",
    details: { organizations: 2, monitorsPaused: 7, statusPagesArchived: 3 },
  });
});

it("changes nothing on a dry run and only counts expired trials", async () => {
  mockWhere.mockResolvedValue([{ count: 4 }]);
  await expect(strategy().execute(true)).resolves.toMatchObject({
    success: true,
    details: { dryRun: true, expiredTrials: 4 },
  });
  expect(mockEndExpiredTrials).not.toHaveBeenCalled();
});

it("reports a failed run instead of throwing so the schedule keeps running", async () => {
  mockEndExpiredTrials.mockRejectedValue(new Error("database unavailable"));
  await expect(strategy().execute()).resolves.toMatchObject({
    success: false,
    errors: ["database unavailable"],
  });
});

it("reports pending expired trials as its statistics", async () => {
  mockWhere.mockResolvedValue([{ count: 3 }]);
  await expect(strategy().getStats()).resolves.toEqual({
    totalRecords: 3,
    oldRecords: 3,
  });
  mockWhere.mockResolvedValue([]);
  await expect(strategy().getStats()).resolves.toEqual({
    totalRecords: 0,
    oldRecords: 0,
  });
});
