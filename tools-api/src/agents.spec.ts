import { afterEach, describe, expect, it, vi } from "vitest";
import { agents, isAllowed, parseRobots } from "./tools/agents";
import { ctxFor, mockFetch } from "./test-helpers";

afterEach(() => vi.restoreAllMocks());

const O = "https://site.com";
const run = () => agents(ctxFor("agents", undefined, "site.com"), new URL(`${O}/some/page`));
const check = (r: Awaited<ReturnType<typeof run>>, id: string) => r.checks.find((c) => c.id === id);

describe("robots.txt matching (RFC 9309)", () => {
  it("uses the agent's own group, else *", () => {
    const g = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n");
    expect(isAllowed(g, "GPTBot")).toBe(true);
    expect(isAllowed(g, "ClaudeBot")).toBe(false);
  });

  it("longest match wins and allow wins ties", () => {
    const g = parseRobots("User-agent: *\nDisallow: /\nAllow: /public\n");
    expect(isAllowed(g, "x", "/public/a")).toBe(true);
    expect(isAllowed(g, "x", "/private")).toBe(false);
    const tie = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a\n");
    expect(isAllowed(tie, "x", "/a")).toBe(true);
  });

  it("supports wildcards, $ anchors, comments, shared groups and empty Disallow", () => {
    const g = parseRobots("# c\nUser-agent: A\nUser-agent: B\nDisallow: /*.pdf$ # pdfs\nDisallow:\n");
    expect(isAllowed(g, "a", "/x.pdf")).toBe(false);
    expect(isAllowed(g, "B", "/x.pdfx")).toBe(true);
    expect(isAllowed(g, "B", "/")).toBe(true);
  });

  it("allows everything with no rules", () => {
    expect(isAllowed(parseRobots(""), "GPTBot")).toBe(true);
  });
});

describe("agents tool", () => {
  it("passes all four checks for a ready site and reports discovery", async () => {
    const { targets } = mockFetch({
      [`${O}/`]: new Response("<html>ok</html>", { headers: { "content-type": "text/html" } }),
      [`${O}/llms.txt`]: new Response("\n# Site\n> about", { headers: { "content-type": "text/plain" } }),
      [`${O}/robots.txt`]: new Response("User-agent: GPTBot\nDisallow: /\n"),
      [`${O}/.well-known/agent-card.json`]: Response.json({
        name: "Bot",
        description: "d",
        supportedInterfaces: [],
        version: "1",
        capabilities: {},
        defaultInputModes: [],
        defaultOutputModes: [],
        skills: [],
      }),
      [`${O}/.well-known/ai-catalog.json`]: Response.json({ servers: [] }),
    });
    const r = await run();
    expect(r.passed).toBe(4);
    expect(r.total).toBe(4);
    expect(check(r, "llms_txt")?.detail).toBe("# Site");
    expect(r.training.find((t) => t.agent === "GPTBot")?.allowed).toBe(false);
    expect(r.discovery.agentCard).toMatchObject({ status: "pass", name: "Bot", missing: [] });
    expect(r.discovery.mcp).toEqual({ status: "pass", path: "/.well-known/ai-catalog.json" });
    // ai-catalog found: the legacy server-card path is never requested
    expect(targets().some((c) => c.url.endsWith("server-card.json"))).toBe(false);
  });

  it("fails llms.txt on 404, warns on HTML or no H1, warns when AI search bots are blocked", async () => {
    mockFetch({
      [`${O}/`]: new Response("ok"),
      [`${O}/llms.txt`]: new Response("<!doctype html><p>hi", { headers: { "content-type": "text/html" } }),
      [`${O}/robots.txt`]: new Response("User-agent: OAI-SearchBot\nDisallow: /\n"),
    });
    const r = await run();
    expect(check(r, "llms_txt")?.status).toBe("warn");
    expect(check(r, "ai_crawlers")).toMatchObject({ status: "warn", detail: "OAI-SearchBot" });

    vi.restoreAllMocks();
    mockFetch({ [`${O}/`]: new Response("ok"), [`${O}/llms.txt`]: new Response("no", { status: 404 }) });
    expect(check(await run(), "llms_txt")).toMatchObject({ status: "fail", detail: "404" });

    vi.restoreAllMocks();
    mockFetch({ [`${O}/`]: new Response("ok"), [`${O}/llms.txt`]: new Response("Site without heading") });
    expect(check(await run(), "llms_txt")?.status).toBe("warn");
  });

  it("flags a bot challenge by header or page signature", async () => {
    mockFetch({ [`${O}/`]: new Response("x", { status: 403, headers: { "cf-mitigated": "challenge" } }) });
    expect(check(await run(), "not_blocked")).toMatchObject({ status: "fail", detail: "403" });
    vi.restoreAllMocks();
    mockFetch({ [`${O}/`]: new Response("<title>Just a moment...</title>", { status: 503 }) });
    expect(check(await run(), "not_blocked")?.status).toBe("fail");
  });

  it("marks http final URL and a dead home page as failures", async () => {
    mockFetch({ [`${O}/`]: () => Promise.reject(new Error("reset")) });
    const r = await run();
    expect(check(r, "https")?.status).toBe("fail");
    expect(check(r, "not_blocked")).toMatchObject({ status: "fail", detail: "connection_failed" });
  });

  it("treats a malformed or incomplete agent card as warn and a missing one as info", async () => {
    mockFetch({ [`${O}/`]: new Response("ok"), [`${O}/.well-known/agent-card.json`]: new Response("{not json") });
    expect((await run()).discovery.agentCard).toMatchObject({ status: "warn", name: null });
    vi.restoreAllMocks();
    mockFetch({ [`${O}/`]: new Response("ok"), [`${O}/.well-known/agent-card.json`]: Response.json({ name: "N" }) });
    const partial = (await run()).discovery.agentCard;
    expect(partial.status).toBe("warn");
    expect(partial.missing).toContain("skills");
    vi.restoreAllMocks();
    mockFetch({ [`${O}/`]: new Response("ok"), [`${O}/.well-known/agent-card.json`]: new Response("", { status: 404 }) });
    expect((await run()).discovery.agentCard.status).toBe("info");
  });

  it("falls back to the legacy MCP server card only on a 404 catalog, and never counts MCP", async () => {
    const { targets } = mockFetch({
      [`${O}/`]: new Response("ok"),
      [`${O}/.well-known/ai-catalog.json`]: new Response("", { status: 404 }),
      [`${O}/.well-known/mcp/server-card.json`]: Response.json({ name: "mcp" }),
    });
    const r = await run();
    expect(r.discovery.mcp).toEqual({ status: "pass", path: "/.well-known/mcp/server-card.json" });
    expect(r.total).toBe(4);
    expect(targets().some((c) => c.url.endsWith("server-card.json"))).toBe(true);
  });

  it("marks truncated robots.txt and keeps hops on the same site", async () => {
    mockFetch({
      [`${O}/`]: new Response("ok"),
      [`${O}/robots.txt`]: new Response("User-agent: *\n" + "Disallow: /x\n".repeat(12_000)),
      [`${O}/llms.txt`]: new Response(null, { status: 302, headers: { location: "https://elsewhere.com/llms.txt" } }),
    });
    const r = await run();
    expect(r.robotsTruncated).toBe(true);
    expect(check(r, "llms_txt")).toMatchObject({ status: "fail", detail: "off_site_redirect" });
  });
});
