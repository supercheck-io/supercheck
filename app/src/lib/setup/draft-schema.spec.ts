import { MAX_DRAFT_BYTES, aiEndpointUrlSchema, parseSetupDraft, schemaError, stripUrl } from "./draft-schema";

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

describe("secret names", () => {
  const key = "sk-live-abcdefghijklmnopqrstuvwxyz0123456789";
  it("rejects a pasted API key in all three secret-name fields", () => {
    expect(parseSetupDraft({ app: { testAccountSecret: key } }).success).toBe(false);
    expect(parseSetupDraft({ monitors: { aiEndpoint: { name: "AI", url: "https://a.io/v1", model: "m", secretKey: key } } }).success).toBe(false);
    expect(parseSetupDraft({ monitors: { mcpMonitor: { name: "M", url: "https://a.io/mcp", secretKey: key } } }).success).toBe(false);
  });
  it("accepts valid variable names and an unset mcp name", () => {
    expect(parseSetupDraft({ app: { testAccountSecret: "SETUP_TEST_PASS" } }).success).toBe(true);
    expect(parseSetupDraft({ monitors: { mcpMonitor: { name: "M", url: "https://a.io/mcp", secretKey: "" } } }).success).toBe(true);
  });
});

describe("setup field limits shared with the UI", () => {
  const ai = (extra: Record<string, unknown>) => ({ monitors: { aiEndpoint: { name: "AI", url: "https://a.io/v1", model: "m", secretKey: "OPENAI_KEY", ...extra } } });
  it("rejects a 21st page, reserved secret names and an http MCP URL", () => {
    const pages = Array.from({ length: 21 }, (_, i) => ({ url: `https://a.io/p${i}`, name: `p${i}` }));
    expect(parseSetupDraft({ monitors: { pages } }).success).toBe(false);
    expect(parseSetupDraft(ai({ secretKey: "PORT" })).success).toBe(false);
    expect(parseSetupDraft(ai({ secretKey: "SUPERCHECK_KEY" })).success).toBe(false);
    expect(parseSetupDraft({ app: { testAccountSecret: "USER" } }).success).toBe(false);
    expect(parseSetupDraft({ monitors: { mcpMonitor: { name: "M", url: "http://a.io/mcp" } } }).success).toBe(false);
    expect(parseSetupDraft({ monitors: { mcpMonitor: { name: "M", url: "https://a.io/mcp" } } }).success).toBe(true);
  });
  it("keeps only api-version from an AI endpoint URL, with a plain value", () => {
    const parsed = parseSetupDraft(ai({ url: "https://x.openai.azure.com/openai/deployments/d/chat?api-version=2024-02-01&api-key=sk-1&token=2" }));
    expect(parsed.success && parsed.data.monitors?.aiEndpoint?.url).toBe("https://x.openai.azure.com/openai/deployments/d/chat?api-version=2024-02-01");
    const odd = parseSetupDraft(ai({ url: "https://a.io/v1?api-version=sk-live-abc$def" }));
    expect(odd.success && odd.data.monitors?.aiEndpoint?.url).toBe("https://a.io/v1");
    expect(schemaError(aiEndpointUrlSchema, "ftp://a.io")).toBe("Must be an http(s) URL");
  });
});

describe("stripUrl", () => {
  it("returns null for garbage and non-http", () => {
    expect(stripUrl("not a url")).toBeNull();
    expect(stripUrl("ftp://x.io")).toBeNull();
    expect(stripUrl(" http://x.io/p?q ")).toBe("http://x.io/p");
  });
});
