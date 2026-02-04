import { getSSLConfig } from "@/utils/db-ssl";

describe("getSSLConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SELF_HOSTED;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns undefined when SELF_HOSTED=true", () => {
    process.env.SELF_HOSTED = "true";
    expect(getSSLConfig()).toBeUndefined();
  });

  it("returns require when SELF_HOSTED=false", () => {
    process.env.SELF_HOSTED = "false";
    expect(getSSLConfig()).toBe("require");
  });

  it("returns require when SELF_HOSTED is not set", () => {
    expect(getSSLConfig()).toBe("require");
  });

  it("treats SELF_HOSTED as case-insensitive", () => {
    process.env.SELF_HOSTED = "TRUE";
    expect(getSSLConfig()).toBeUndefined();
  });
});
