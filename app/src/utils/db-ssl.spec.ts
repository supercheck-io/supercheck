import { getSSLConfig } from "@/utils/db-ssl";

describe("getSSLConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DB_SSL;
    delete process.env.SELF_HOSTED;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns undefined when SELF_HOSTED=true and DB_SSL is not set", () => {
    process.env.SELF_HOSTED = "true";
    expect(getSSLConfig()).toBeUndefined();
  });

  it("returns require when SELF_HOSTED=false and DB_SSL is not set", () => {
    process.env.SELF_HOSTED = "false";
    expect(getSSLConfig()).toBe("require");
  });

  it("returns undefined when DB_SSL=false regardless of SELF_HOSTED", () => {
    process.env.DB_SSL = "false";
    process.env.SELF_HOSTED = "false";
    expect(getSSLConfig()).toBeUndefined();
  });

  it("returns require when DB_SSL=true regardless of SELF_HOSTED", () => {
    process.env.DB_SSL = "true";
    process.env.SELF_HOSTED = "true";
    expect(getSSLConfig()).toBe("require");
  });
});
