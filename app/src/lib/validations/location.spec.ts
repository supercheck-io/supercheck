import { createLocationSchema } from "./location";

describe("location queue names", () => {
  it.each(["scheduler", "job-scheduler"])("rejects %s because it collides with a scheduler queue", (code) => {
    expect(createLocationSchema.safeParse({ code, name: "Region" }).success).toBe(false);
  });

  it("accepts an ordinary regional code", () => {
    expect(createLocationSchema.safeParse({ code: "eu-central", name: "Europe" }).success).toBe(true);
  });
});
