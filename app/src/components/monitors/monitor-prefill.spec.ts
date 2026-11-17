import { draftForHandoff, draftForUiType, monitorPrefill } from "./monitor-prefill";

const q = (s: string) => new URLSearchParams(s);

describe("monitorPrefill", () => {
  it("fills target and name for a website monitor", () => {
    expect(monitorPrefill(q("type=website&url=https%3A%2F%2Fex.com%2Fa%3Fb%3D1&name=ex.com"), "website")).toEqual({
      target: "https://ex.com/a?b=1",
      name: "ex.com",
      websiteConfig_enableSslCheck: true,
    });
    expect(monitorPrefill(q("url=http%3A%2F%2Fex.com"), "website")).toEqual({ target: "http://ex.com" });
  });

  it("fills GET or HEAD for an HTTP monitor only", () => {
    expect(monitorPrefill(q("url=https%3A%2F%2Fapi.ex.com&method=HEAD"), "http_request")).toEqual({
      target: "https://api.ex.com",
      httpConfig_method: "HEAD",
    });
    expect(monitorPrefill(q("url=https%3A%2F%2Fex.com&method=HEAD"), "website")).toEqual({ target: "https://ex.com", websiteConfig_enableSslCheck: true });
    expect(monitorPrefill(q("method=POST"), "http_request")).toEqual({});
  });

  it("ignores non-http URLs, oversized values and other monitor types", () => {
    expect(monitorPrefill(q("url=javascript%3Aalert(1)"), "website")).toEqual({});
    expect(monitorPrefill(q(`url=https%3A%2F%2F${"a".repeat(2100)}`), "website")).toEqual({});
    expect(monitorPrefill(q("url=https%3A%2F%2Fex.com"), "ping_host")).toEqual({});
    expect(monitorPrefill(null, "website")).toEqual({});
    expect(monitorPrefill(q(`name=${"n".repeat(150)}`), "website").name).toHaveLength(100);
  });
});

describe("draftForHandoff", () => {
  const draft = { target: "https://old.example/", name: "old" };
  it("drops a draft for another target when a hand-off is present", () => {
    expect(draftForHandoff(draft, "https://new.example/")).toBeUndefined();
  });
  it("keeps the draft without a hand-off, or when it is for the same target", () => {
    expect(draftForHandoff(draft, null)).toBe(draft);
    expect(draftForHandoff(draft, "https://old.example/")).toBe(draft);
    expect(draftForHandoff(undefined, "https://new.example/")).toBeUndefined();
  });
});

describe("draftForUiType", () => {
  it("keeps a draft only for the same UI type", () => {
    const http: { target: string; preset?: string } = { target: "https://a.example/" };
    const ai = { target: "https://api.example/v1/chat/completions", preset: "ai_endpoint" };
    expect(draftForUiType(http, false)).toBe(http);
    expect(draftForUiType(ai, true)).toBe(ai);
    expect(draftForUiType(http, true)).toBeUndefined();
    expect(draftForUiType(ai, false)).toBeUndefined();
    expect(draftForUiType(undefined, true)).toBeUndefined();
  });
});
