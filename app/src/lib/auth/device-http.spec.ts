/** @jest-environment node */
import { NextRequest } from "next/server";
import { readDeviceBody, deviceBaseUrl } from "./device-http";
import { sanitizeClientMetadata, normalizeUserCode, USER_CODE_ALPHABET } from "./device-authorization";

jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/rbac/middleware", () => ({}));

const post = (body: string, headers: Record<string, string> = {}) =>
  new NextRequest("https://app.example.com/x", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body });

describe("readDeviceBody", () => {
  it("parses form and JSON bodies", async () => {
    expect(await readDeviceBody(post("a=1&b=two"))).toEqual({ a: "1", b: "two" });
    expect(await readDeviceBody(post('{"a":"1","n":2}', { "content-type": "application/json" }))).toEqual({ a: "1" });
  });
  it("rejects oversized, malformed and non-object bodies", async () => {
    expect(await readDeviceBody(post("a=" + "x".repeat(5000)))).toBeNull();
    expect(await readDeviceBody(post("x", { "content-length": "999999" }))).toBeNull();
    expect(await readDeviceBody(post("[1]", { "content-type": "application/json" }))).toBeNull();
    expect(await readDeviceBody(post("{bad", { "content-type": "application/json" }))).toBeNull();
  });
});

describe("deviceBaseUrl", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  it("prefers the configured origin over request-derived values", () => {
    process.env.APP_URL = "https://configured.example.com";
    expect(deviceBaseUrl(post("a=1", { host: "evil.example" }))).toBe("https://configured.example.com");
  });
  it("keeps a self-hosted path prefix but drops trailing slashes, query and hash", () => {
    process.env.APP_URL = "https://host.example.com/supercheck/?x=1#h";
    expect(deviceBaseUrl(post("a=1", {}))).toBe("https://host.example.com/supercheck");
  });
});

describe("sanitizeClientMetadata", () => {
  it("strips control, bidi and zero-width characters and truncates", () => {
    const out = sanitizeClientMetadata({ hostname: "lap‮top​\n" + "x".repeat(100), clientName: 42, cliVersion: "1.0\u0000" }, "203.0.113.9");
    expect(out.hostname).toBe(("laptop" + "x".repeat(100)).slice(0, 64));
    expect(out.cliVersion).toBe("1.0");
    expect(out.clientName).toBeUndefined();
    expect(out.requestIp).toBe("203.0.113.9");
  });
  it("ignores unknown keys and the unknown IP", () => {
    expect(sanitizeClientMetadata({ admin: "true" }, "unknown")).toEqual({});
    expect(sanitizeClientMetadata(null)).toEqual({});
  });
});

describe("user code alphabet", () => {
  it("has no vowels or look-alike characters", () => {
    expect(USER_CODE_ALPHABET).not.toMatch(/[AEIOUL015S]/);
    expect(normalizeUserCode("bcdf-ghjk")).toBe("BCDFGHJK");
  });
});
