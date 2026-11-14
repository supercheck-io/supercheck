import { CheckContext, CheckStop, readCapped, walk } from "../context";

export const AI_SEARCH_AGENTS = ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User"];
export const AI_TRAINING_AGENTS = [
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "CCBot",
  "Applebot-Extended",
  "Bytespider",
  "meta-externalagent",
];
const AGENT_CARD_FIELDS = [
  "name",
  "description",
  "supportedInterfaces",
  "version",
  "capabilities",
  "defaultInputModes",
  "defaultOutputModes",
  "skills",
];

interface Rule {
  allow: boolean;
  path: string;
}

/** Parses robots.txt into groups keyed by lowercase user agent (RFC 9309). */
export function parseRobots(text: string): Map<string, Rule[]> {
  const groups = new Map<string, Rule[]>();
  let agents: string[] = [];
  let inRules = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (inRules) {
        agents = [];
        inRules = false;
      }
      const agent = value.toLowerCase();
      agents.push(agent);
      if (!groups.has(agent)) groups.set(agent, []);
    } else if (key === "allow" || key === "disallow") {
      inRules = true;
      for (const agent of agents) groups.get(agent)!.push({ allow: key === "allow", path: value });
    }
  }
  return groups;
}

function matches(pattern: string, path: string): boolean {
  if (pattern === "") return false;
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

/** RFC 9309: the agent's own group (else `*`), longest match wins, allow wins ties. */
export function isAllowed(groups: Map<string, Rule[]>, agent: string, path = "/"): boolean {
  const rules = groups.get(agent.toLowerCase()) ?? groups.get("*") ?? [];
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!matches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

type Status = "pass" | "warn" | "fail" | "info";

interface Fetched {
  status: number | null;
  type: string | null;
  text: string;
  truncated: boolean;
  error?: string;
}

async function get(ctx: CheckContext, origin: URL, path: string, cap: number): Promise<Fetched> {
  try {
    const r = await walk(ctx, new URL(path, origin), { maxHops: 2 });
    if (!r.ok) return { status: null, type: null, text: "", truncated: false, error: r.error };
    const type = r.res.headers.get("content-type");
    if (r.res.status !== 200) {
      await r.res.body?.cancel();
      return { status: r.res.status, type, text: "", truncated: false };
    }
    const body = await readCapped(r.res, cap);
    return { status: 200, type, ...body };
  } catch (error) {
    if (!(error instanceof CheckStop) || error.reason === "subrequest_budget") throw error;
    return { status: null, type: null, text: "", truncated: false, error: error.reason };
  }
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** Tool 5: four counted checks, plus discovery (agent card, MCP) shown but not counted. */
export async function agents(ctx: CheckContext, url: URL) {
  const origin = new URL(url.origin);
  // Two sequential groups of at most three requests keep us well under six connections.
  const home = await walk(ctx, origin, { maxHops: 2 }).catch((error) => {
    if (error instanceof CheckStop && error.reason !== "subrequest_budget") return null;
    throw error;
  });
  const [llms, robots] = await Promise.all([get(ctx, origin, "/llms.txt", 16 * 1024), get(ctx, origin, "/robots.txt", 128 * 1024)]);
  const [card, catalog] = await Promise.all([
    get(ctx, origin, "/.well-known/agent-card.json", 64 * 1024),
    get(ctx, origin, "/.well-known/ai-catalog.json", 64 * 1024),
  ]);
  // The legacy server-card path is only tried when the AI catalog is missing.
  const serverCard = catalog.status === 404 ? await get(ctx, origin, "/.well-known/mcp/server-card.json", 64 * 1024) : null;

  const checks: { id: string; status: Status; detail: string | null }[] = [];

  const finalUrl = home && home.ok ? home.url : null;
  checks.push({
    id: "https",
    status: finalUrl?.protocol === "https:" ? "pass" : "fail",
    detail: finalUrl ? finalUrl.protocol.replace(":", "") : null,
  });

  if (llms.status === 200) {
    const firstLine = llms.text.split(/\r?\n/).find((l) => l.trim() !== "")?.trim() ?? "";
    const html = /html/i.test(llms.type ?? "") || /^<(!doctype|html)/i.test(firstLine);
    checks.push({
      id: "llms_txt",
      status: !html && firstLine.startsWith("# ") ? "pass" : "warn",
      detail: firstLine.slice(0, 200) || null,
    });
  } else {
    checks.push({ id: "llms_txt", status: "fail", detail: llms.status ? String(llms.status) : (llms.error ?? null) });
  }

  const groups = robots.status === 200 ? parseRobots(robots.text) : new Map<string, Rule[]>();
  const searchBlocked = AI_SEARCH_AGENTS.filter((agent) => !isAllowed(groups, agent));
  checks.push({
    id: "ai_crawlers",
    status: searchBlocked.length === 0 ? "pass" : "warn",
    detail: searchBlocked.length ? searchBlocked.join(", ") : null,
  });

  let challenged = false;
  if (home && home.ok) {
    const status = home.res.status;
    const mitigated = home.res.headers.get("cf-mitigated") === "challenge";
    challenged = mitigated || ((status === 403 || status === 429 || status === 503) && (await looksLikeChallenge(home.res)));
    await home.res.body?.cancel().catch(() => undefined);
    checks.push({ id: "not_blocked", status: challenged || status >= 400 ? "fail" : "pass", detail: String(status) });
  } else {
    checks.push({ id: "not_blocked", status: "fail", detail: home && !home.ok ? home.error : "blocked" });
  }

  const cardJson = card.status === 200 ? parseJson(card.text) : null;
  const missingFields = cardJson ? AGENT_CARD_FIELDS.filter((f) => !(f in cardJson)) : [];
  const agentCard =
    card.status === 200
      ? cardJson
        ? {
            status: (missingFields.length ? "warn" : "pass") as Status,
            name: typeof cardJson.name === "string" ? cardJson.name.slice(0, 200) : null,
            missing: missingFields,
          }
        : { status: "warn" as Status, name: null, missing: AGENT_CARD_FIELDS }
      : { status: "info" as Status, name: null, missing: [] };

  const mcpSource = catalog.status === 200 ? catalog : serverCard?.status === 200 ? serverCard : null;
  const mcp = {
    status: (mcpSource && parseJson(mcpSource.text) ? "pass" : "info") as Status,
    path: mcpSource === catalog ? "/.well-known/ai-catalog.json" : mcpSource ? "/.well-known/mcp/server-card.json" : null,
  };

  return {
    passed: checks.filter((c) => c.status === "pass").length,
    total: checks.length,
    checks,
    training: AI_TRAINING_AGENTS.map((agent) => ({ agent, allowed: isAllowed(groups, agent) })),
    robotsTruncated: robots.truncated,
    discovery: { agentCard, mcp },
  };
}

async function looksLikeChallenge(res: Response): Promise<boolean> {
  const { text } = await readCapped(res, 16 * 1024);
  return /challenge-platform|cf-chl-|just a moment|captcha/i.test(text);
}
