/** @jest-environment node */
import { TRIAL_RETENTION } from "@/lib/execution/trial-limits";
import { resolveRawRetention, SHORTEST_RAW_RETENTION_DAYS } from "./raw-retention";

const cloud = (subscriptionPlan: string | null, subscriptionStatus: string | null, planDays?: number) =>
  resolveRawRetention({ selfHosted: false, subscriptionPlan, subscriptionStatus, planDays });

describe("resolveRawRetention", () => {
  it("takes the shortest raw window from the catalog's trial retention", () => {
    expect(SHORTEST_RAW_RETENTION_DAYS).toBe(TRIAL_RETENTION.dataRetentionDays);
  });

  it("self-hosted uses the unlimited row, or the shortest window without one", () => {
    expect(resolveRawRetention({ selfHosted: true, unlimitedDays: 14 })).toEqual({ days: 14, onPlan: false });
    expect(resolveRawRetention({ selfHosted: true, unlimitedDays: undefined })).toEqual({ days: SHORTEST_RAW_RETENTION_DAYS, onPlan: false });
    expect(resolveRawRetention({ selfHosted: true, unlimitedDays: 0 })).toEqual({ skip: expect.stringContaining("not a positive") });
  });

  it("a plan uses its row, even a short one, and is skipped without one", () => {
    expect(cloud("pro", "active", 30)).toEqual({ days: 30, onPlan: true });
    expect(cloud("plus", "canceled", 3)).toEqual({ days: 3, onPlan: true });
    expect(cloud("unlimited", "active", undefined)).toEqual({ skip: expect.stringContaining("no plan_limits row") });
  });

  it.each([0, -1, 1.5])("skips a plan window of %s days instead of deleting everything", (days) => {
    expect(cloud("plus", "active", days)).toEqual({ skip: expect.stringContaining("not a positive") });
  });

  it.each(["active", "past_due"])("skips a %s subscription whose plan is not set yet", (status) => {
    expect(cloud(null, status)).toEqual({ skip: expect.stringContaining(status) });
  });

  it.each([null, "canceled", "none"])("gives no plan with status %s the shortest raw window", (status) => {
    expect(cloud(null, status)).toEqual({ days: SHORTEST_RAW_RETENTION_DAYS, onPlan: false });
  });
});
