/** @jest-environment node */
import {
  DEFAULT_DELIVERY_RETENTION_DAYS,
  resolveDeliveryRetentionDays,
} from "./delivery-worker";

describe("delivery retention window", () => {
  it("defaults to 30 days when the variable is absent or empty", () => {
    expect(DEFAULT_DELIVERY_RETENTION_DAYS).toBe(30);
    expect(resolveDeliveryRetentionDays(undefined)).toBe(30);
    expect(resolveDeliveryRetentionDays("")).toBe(30);
    expect(resolveDeliveryRetentionDays("   ")).toBe(30);
  });

  it("accepts positive whole-day windows", () => {
    expect(resolveDeliveryRetentionDays("1")).toBe(1);
    expect(resolveDeliveryRetentionDays("90")).toBe(90);
  });

  it.each(["0", "-1", "1.5", "abc", "3651"])(
    "falls back to the default for the invalid value %s",
    (value) => {
      expect(resolveDeliveryRetentionDays(value)).toBe(
        DEFAULT_DELIVERY_RETENTION_DAYS,
      );
    },
  );
});
