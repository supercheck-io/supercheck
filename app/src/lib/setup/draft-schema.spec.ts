import { MAX_DRAFT_BYTES, parseSetupDraft, stripUrl } from "./draft-schema";

describe("parseSetupDraft", () => {
  it("accepts an empty or null draft", () => {
    expect(parseSetupDraft({})).toEqual({ success: true, data: {} });
    expect(parseSetupDraft(null)).toEqual({ success: true, data: {} });
  });

  it("rejects an unknown key at the top level and inside a step", () => {
    expect(parseSetupDraft({ token: "x" }).success).toBe(false);
    expect(parseSetupDraft({ app: { url: "https://a.io", password: "p" } }).success).toBe(false);
  });

  it("rejects a draft over 32 KB", () => {
    const big = { tests: { requirements: Array.from({ length: 50 }, () => ({ title: "t", description: "x".repeat(900) })) } };
    expect(JSON.stringify(big).length).toBeGreaterThan(MAX_DRAFT_BYTES);
    const result = parseSetupDraft(big);
    expect(result).toEqual({ success: false, error: "Draft is larger than 32 KB" });
  });

  it("rejects non-serializable input", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(parseSetupDraft(cyclic).success).toBe(false);
  });

  it("strips query, fragment and userinfo from URLs", () => {
    const result = parseSetupDraft({ app: { url: "https://user:pw@example.com/app?token=1#frag" }, monitors: { pages: [{ url: "https://example.com/a?x=1", name: "A" }] } });
    expect(result).toMatchObject({ success: true, data: { app: { url: "https://example.com/app" }, monitors: { pages: [{ url: "https://example.com/a" }] } } });
  });

  it("rejects non-http URLs and reports the path", () => {
    const result = parseSetupDraft({ app: { url: "javascript:alert(1)" } });
    expect(result).toMatchObject({ success: false });
    expect((result as { error: string }).error).toContain("app.url");
  });
});

describe("stripUrl", () => {
  it("returns null for garbage and non-http", () => {
    expect(stripUrl("not a url")).toBeNull();
    expect(stripUrl("ftp://x.io")).toBeNull();
    expect(stripUrl(" http://x.io/p?q ")).toBe("http://x.io/p");
  });
});
