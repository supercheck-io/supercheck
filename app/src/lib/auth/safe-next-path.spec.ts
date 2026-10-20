import { buildDeviceReturnPath, sanitizeNextPath } from "./safe-next-path";

describe("sanitizeNextPath", () => {
  it.each([
    ["/device", "/device"],
    ["/device?code=BCDF-GHJK", "/device?code=BCDF-GHJK"],
    [encodeURIComponent("/device?code=BCDF-GHJK"), "/device?code=BCDF-GHJK"],
  ])("accepts %s", (input, expected) => {
    expect(sanitizeNextPath(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "https://evil.example/device",
    "//evil.example/device",
    "/\\evil.example",
    "/%2F%2Fevil.example",
    "/device/../admin",
    "/device?code=x&next=https://evil.example",
    "/device?code=%0d%0aSet-Cookie:x",
    "/dashboard",
    "/devices",
    "/device#frag",
    "/" + "a".repeat(80),
    "%E0%A4%A",
  ])("rejects %p", (input) => {
    expect(sanitizeNextPath(input as string | null | undefined)).toBeNull();
  });
});

describe("buildDeviceReturnPath", () => {
  it("only embeds well-formed codes", () => {
    expect(buildDeviceReturnPath("BCDF-GHJK")).toBe("/device?code=BCDF-GHJK");
    expect(buildDeviceReturnPath("a&b=c")).toBe("/device");
    expect(buildDeviceReturnPath(undefined)).toBe("/device");
  });
});
