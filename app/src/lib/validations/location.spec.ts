import { createLocationSchema } from "./location";

describe("location queue names", () => {
  it.each(["scheduler", "job-scheduler"])("rejects %s because it collides with a scheduler queue", (code) => {
    expect(createLocationSchema.safeParse({ code, name: "Region" }).success).toBe(false);
  });

  it("accepts an ordinary regional code", () => {
    expect(createLocationSchema.safeParse({ code: "eu-central", name: "Europe" }).success).toBe(true);
  });
});

describe("location capabilities and availability on create", () => {
  const base = { code: "sa-east", name: "Brazil" };

  it("keeps every new field optional so existing API clients are unaffected", () => {
    const parsed = createLocationSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(base);
  });

  it("accepts explicit capabilities and a disabled start", () => {
    expect(
      createLocationSchema.safeParse({
        ...base,
        isEnabled: false,
        supportsBrowser: false,
        supportsK6: false,
      }).success
    ).toBe(true);
  });

  it.each(["isEnabled", "supportsBrowser", "supportsK6"])("rejects a non-boolean %s", (field) => {
    expect(createLocationSchema.safeParse({ ...base, [field]: "yes" }).success).toBe(false);
  });
});
