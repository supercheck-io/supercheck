import { getPolarConfig, validatePolarConfig } from "./feature-flags";

const KEYS = ["SELF_HOSTED", "POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET", "POLAR_PLUS_PRODUCT_ID", "POLAR_PRO_PRODUCT_ID", "POLAR_SERVER"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  Object.assign(process.env, {
    SELF_HOSTED: "false",
    POLAR_ACCESS_TOKEN: "t",
    POLAR_WEBHOOK_SECRET: "s",
    POLAR_PLUS_PRODUCT_ID: "a",
    POLAR_PRO_PRODUCT_ID: "b",
  });
});
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("POLAR_SERVER", () => {
  it.each([undefined, "", "staging"])("is rejected in cloud mode when %j", (value) => {
    if (value === undefined) Reflect.deleteProperty(process.env, "POLAR_SERVER");
    else process.env.POLAR_SERVER = value;
    expect(() => validatePolarConfig()).toThrow(/POLAR_SERVER/);
    expect(() => getPolarConfig()).toThrow(/POLAR_SERVER/);
  });

  it.each(["sandbox", "production"] as const)("accepts %s", (value) => {
    process.env.POLAR_SERVER = value;
    expect(() => validatePolarConfig()).not.toThrow();
    expect(getPolarConfig()?.server).toBe(value);
  });

  it("is not required in self-hosted mode", () => {
    process.env.SELF_HOSTED = "true";
    Reflect.deleteProperty(process.env, "POLAR_SERVER");
    expect(() => validatePolarConfig()).not.toThrow();
    expect(getPolarConfig()).toBeNull();
  });
});
