/** @jest-environment node */
const mockWhere = jest.fn();
const mockEndExpiredTrials = jest.fn();
const mockReconcile = jest.fn();
const mockSendTrialReminders = jest.fn();
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
  sendTrialReminders: (...args: unknown[]) => mockSendTrialReminders(...args),
  reconcilePaidTrialSuspensions: (...args: unknown[]) => mockReconcile(...args),
}));
jest.mock("@/lib/execution/trial-reminder-delivery", () => ({
  deliverTrialReminder: jest.fn(),
}));
import { TrialLifecycleStrategy } from "./data-lifecycle-service";

const strategy = () =>
  new TrialLifecycleStrategy({
    entityType: "trial_lifecycle",
    cronSchedule: "*/15 * * * *",
    enabled: true,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockSendTrialReminders.mockResolvedValue({ midway: 0, ending: 0, ended: 0 });
  mockReconcile.mockResolvedValue({ organizations: 0, monitorsResumed: 0, statusPagesRestored: 0 });
});

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

it("sends reminders after ending trials and reports them", async () => {
  mockEndExpiredTrials.mockResolvedValue({
    organizations: 1,
    monitorsPaused: 2,
    statusPagesArchived: 1,
  });
  mockSendTrialReminders.mockResolvedValue({ midway: 3, ending: 1, ended: 1 });
  const result = await strategy().execute();
  expect(result.success).toBe(true);
  expect(result.details).toMatchObject({
    organizations: 1,
    reminders: { midway: 3, ending: 1, ended: 1 },
  });
  expect(mockSendTrialReminders).toHaveBeenCalledWith({
    deliver: expect.any(Function),
  });
});

it("still ends trials when reminders fail, and records the problem", async () => {
  mockEndExpiredTrials.mockResolvedValue({
    organizations: 1,
    monitorsPaused: 2,
    statusPagesArchived: 0,
  });
  mockSendTrialReminders.mockRejectedValue(new Error("SMTP unavailable"));
  const result = await strategy().execute();
  expect(result.success).toBe(true);
  expect(result.details).toMatchObject({ organizations: 1 });
  expect(result.errors).toEqual(["Trial reminders failed: SMTP unavailable"]);
});

it("still sends reminders when ending trials fails", async () => {
  mockEndExpiredTrials.mockRejectedValue(new Error("database unavailable"));
  await strategy().execute();
  expect(mockSendTrialReminders).toHaveBeenCalled();
});

it("repairs paid organizations that are still suspended and keeps going if that fails", async () => {
  mockEndExpiredTrials.mockResolvedValue({ organizations: 0, monitorsPaused: 0, statusPagesArchived: 0 });
  mockReconcile.mockResolvedValueOnce({ organizations: 1, monitorsResumed: 2, statusPagesRestored: 1 });
  await expect(strategy().execute(false)).resolves.toMatchObject({
    details: { restored: { organizations: 1, monitorsResumed: 2, statusPagesRestored: 1 } },
  });
  mockReconcile.mockRejectedValueOnce(new Error("db down"));
  const failed = await strategy().execute(false);
  expect(failed.errors).toEqual(["Trial restore reconciliation failed: db down"]);
  expect(mockSendTrialReminders).toHaveBeenCalledTimes(2);
});
