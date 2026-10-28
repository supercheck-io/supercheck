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

describe("subscriber sweep", () => {
  it("also drops unverified rows that never completed verification", async () => {
    const where = jest.fn();
    jest.resetModules();
    jest.doMock("@/utils/db", () => ({
      db: { delete: () => ({ where: (w: unknown) => (where(w), Promise.resolve()) }) },
    }));
    const { purgeStaleSubscribers } = await import("./delivery-worker");
    await purgeStaleSubscribers();
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const { sql: text } = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(text).toMatch(/"purge_at" < \$\d/);
    expect(text).toMatch(/"verified_at" is null/);
    expect(text).toMatch(/"updated_at" < \$\d/);
  });
});
