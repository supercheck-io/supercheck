import {
  currentNextPath,
  withNextPath,
  buildDeviceReturnPath,
  buildOAuthResumePath,
  isOAuthResumePath,
  sanitizeNextPath,
} from "./safe-next-path";

describe("sanitizeNextPath", () => {
  it.each([
    ["/device", "/device"],
    ["/org-admin", "/org-admin"],
    ["/switch-organization?org=01a1cc16-a6e5-7685-aaf1-5a7a3f714c3c", "/switch-organization?org=01a1cc16-a6e5-7685-aaf1-5a7a3f714c3c"],
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

describe("sanitizeNextPath: pre-filled monitor form from the free tools", () => {
  // What the tools page builds: values encoded once, then the whole path encoded again.
  const built = (url: string, extra = "") =>
    `/monitors/create?type=website&url=${encodeURIComponent(url)}&name=${encodeURIComponent(new URL(url).hostname)}${extra}`;
  // The browser decodes the outer layer; the app reads searchParams.get("next").
  const afterBrowser = (path: string) =>
    new URL(`https://app.example/sign-in?next=${encodeURIComponent(path)}`).searchParams.get("next");

  it.each([
    "https://ex.com/",
    "https://ex.com/a?b=1&c=2",
    "https://ex.com/a#frag",
    "https://ex.com/a+b%20c",
    "https://ex.com/100%",
    "https://en.wikipedia.org/wiki/Foo_(bar)/",
    "https://ex.com/a*b!c'd",
  ])("round-trips %s with its values still encoded", (url) => {
    const path = built(url);
    const next = afterBrowser(path);
    expect(sanitizeNextPath(next)).toBe(path);
    const params = new URLSearchParams(path.split("?")[1]);
    expect(params.get("url")).toBe(url);
    expect([...params.keys()]).toEqual(["type", "url", "name"]);
  });

  it("accepts the form URLSearchParams re-serializes to (the wizard rewrites the query on mount)", () => {
    const params = new URLSearchParams({ type: "website", url: "https://ex.com/a_(b)*", name: "ex.com" });
    const path = `/monitors/create?${params.toString()}`;
    expect(sanitizeNextPath(path)).toBe(path);
  });

  it("accepts http_request with a HEAD method", () => {
    const path = `/monitors/create?type=http_request&url=${encodeURIComponent("https://api.ex.com/h")}&name=api.ex.com&method=HEAD`;
    expect(sanitizeNextPath(path)).toBe(path);
  });

  it.each([
    ["an unknown type", "/monitors/create?type=ping_host&url=x.com"],
    ["an extra parameter", `/monitors/create?type=website&url=x.com&next=${encodeURIComponent("//evil.example")}`],
    ["a decoded ampersand in a value", "/monitors/create?type=website&url=https://x.com/?a=1&b=2"],
    ["a fragment", "/monitors/create?type=website&url=x.com#x"],
    ["a protocol-relative prefix", "//monitors/create?type=website&url=x.com"],
    ["a javascript: value", "/monitors/create?type=website&url=javascript:alert(1)"],
    ["a POST method", "/monitors/create?type=http_request&url=x.com&method=POST"],
    ["parameters out of order", "/monitors/create?url=x.com&type=website"],
    ["a url over the cap", `/monitors/create?type=website&url=${"a".repeat(6201)}`],
    ["a name over the cap", `/monitors/create?type=website&url=x.com&name=${"a".repeat(301)}`],
    ["the whole path doubly encoded", encodeURIComponent("/monitors/create?type=website&url=x.com")],
  ])("rejects %s", (_name, input) => {
    expect(sanitizeNextPath(input)).toBeNull();
  });

  it("keeps the 128 cap for every other path", () => {
    expect(sanitizeNextPath(`/device?code=${"A".repeat(130)}`)).toBeNull();
  });
});

describe("withNextPath and currentNextPath", () => {
  const monitor = "/monitors/create?type=website&url=https%3A%2F%2Fex.com%2F&name=ex.com";
  it("appends only a valid continuation", () => {
    expect(withNextPath("/subscribe", monitor)).toBe(`/subscribe?next=${encodeURIComponent(monitor)}`);
    expect(withNextPath("https://app.example/billing/success?checkout_id={CHECKOUT_ID}", monitor)).toBe(
      `https://app.example/billing/success?checkout_id={CHECKOUT_ID}&next=${encodeURIComponent(monitor)}`,
    );
    expect(withNextPath("/subscribe", "/dashboard")).toBe("/subscribe");
    expect(withNextPath("/subscribe", "https://evil.example")).toBe("/subscribe");
    expect(withNextPath("/subscribe", undefined)).toBe("/subscribe");
  });
  it("reads and sanitizes next from the current URL", () => {
    window.history.pushState({}, "", `/subscribe?next=${encodeURIComponent(monitor)}`);
    expect(currentNextPath()).toBe(monitor);
    window.history.pushState({}, "", "/subscribe?next=%2F%2Fevil.example");
    expect(currentNextPath()).toBeNull();
    window.history.pushState({}, "", "/");
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
