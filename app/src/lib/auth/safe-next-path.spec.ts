import {
  buildDeviceReturnPath,
  buildOAuthResumePath,
  isOAuthResumePath,
  sanitizeNextPath,
} from "./safe-next-path";

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

describe("buildOAuthResumePath", () => {
  const signed = (extra: Record<string, string> = {}) =>
    new URLSearchParams({
      response_type: "code",
      client_id: "client-1",
      redirect_uri: "http://127.0.0.1:8765/callback",
      exp: "1792580000",
      sig: "abc123",
      ...extra,
    });

  it("replays a signed authorization request against the authorize endpoint", () => {
    const params = signed();
    expect(buildOAuthResumePath(params)).toBe(`/api/auth/oauth2/authorize?${params.toString()}`);
  });

  it("always targets the fixed authorize path, whatever else the query carries", () => {
    const path = buildOAuthResumePath(signed({ next: "https://evil.example", callbackURL: "//evil.example" }));
    expect(path?.startsWith("/api/auth/oauth2/authorize?")).toBe(true);
    expect(new URL(path as string, "https://app.example").origin).toBe("https://app.example");
  });

  it.each([
    ["no response_type", (p: URLSearchParams) => p.delete("response_type")],
    ["a non-code response_type", (p: URLSearchParams) => p.set("response_type", "token")],
    ["no client_id", (p: URLSearchParams) => p.delete("client_id")],
    ["an empty client_id", (p: URLSearchParams) => p.set("client_id", "")],
    ["no signature", (p: URLSearchParams) => p.delete("sig")],
    ["no expiry", (p: URLSearchParams) => p.delete("exp")],
  ])("returns null with %s", (_name, mutate) => {
    const params = signed();
    mutate(params);
    expect(buildOAuthResumePath(params)).toBeNull();
  });

  it("returns null for an oversized query and for missing params", () => {
    expect(buildOAuthResumePath(signed({ state: "x".repeat(5000) }))).toBeNull();
    expect(buildOAuthResumePath(null)).toBeNull();
    expect(buildOAuthResumePath(undefined)).toBeNull();
  });
});

describe("isOAuthResumePath", () => {
  it("recognises only resume paths built by this module", () => {
    expect(isOAuthResumePath("/api/auth/oauth2/authorize?client_id=a")).toBe(true);
    expect(isOAuthResumePath("/device")).toBe(false);
    expect(isOAuthResumePath("/api/auth/oauth2/token?x=1")).toBe(false);
    expect(isOAuthResumePath(null)).toBe(false);
  });
});
