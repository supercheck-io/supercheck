import { cacheGet, cacheKey, cachePut } from "./cache";
import { CheckContext, CheckStop, readCapped } from "./context";
import { list, TOOLS, type Env, type Tool } from "./env";
import { ipBucket } from "./ip-ranges";
import { describeTarget, hashIp, logCheck, type CheckLog } from "./log";
import { verifyTurnstile } from "./turnstile";
import { checkDomain, checkUrl, registrable } from "./url-policy";
import { agents } from "./tools/agents";
import { dns } from "./tools/dns";
import { domain } from "./tools/domain";
import { api, headers, uptime } from "./tools/http";
import { https } from "./tools/https";
import { social } from "./tools/social";

const BODY_CAP = 4096;
const FIELD_CAP = 2048;
const DOMAIN_TOOLS: Tool[] = ["dns", "domain"];

interface CheckRequest {
  tool: Tool;
  input: string;
  method: "GET" | "HEAD";
  token: string;
}

function json(status: number, body: unknown, extra: HeadersInit = {}): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers });
}

/** Echoes the Origin only when it is allowed. Credentials are never allowed. */
export function originAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  if (list(env.ALLOWED_ORIGINS).includes(origin.toLowerCase())) return true;
  return env.ALLOW_PREVIEW_ORIGINS === "true" && /^https:\/\/[a-z0-9-]+\.supercheck\.pages\.dev$/i.test(origin);
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const base: Record<string, string> = { vary: "Origin" };
  if (origin && originAllowed(origin, env)) {
    base["access-control-allow-origin"] = origin;
    base["access-control-allow-methods"] = "POST, OPTIONS";
    base["access-control-allow-headers"] = "content-type";
    base["access-control-max-age"] = "86400";
  }
  return base;
}

export function parseBody(text: string, enabled: string[]): { ok: true; value: CheckRequest } | { ok: false; reason: string } {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, reason: "bad_json" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "bad_json" };
  const { tool, input, method, token } = body as Record<string, unknown>;
  if (typeof tool !== "string" || !(TOOLS as readonly string[]).includes(tool)) return { ok: false, reason: "unknown_tool" };
  if (!enabled.includes(tool)) return { ok: false, reason: "tool_disabled" };
  if (typeof input !== "string" || input.trim() === "" || input.length > FIELD_CAP) return { ok: false, reason: "missing_input" };
  if (typeof token !== "string" || token === "" || token.length > FIELD_CAP) return { ok: false, reason: "missing_token" };
  if (method !== undefined && (tool !== "api" || (method !== "GET" && method !== "HEAD"))) return { ok: false, reason: "bad_method" };
  return { ok: true, value: { tool: tool as Tool, input, method: (method as "GET" | "HEAD") ?? "GET", token } };
}

async function runTool(ctx: CheckContext, req: CheckRequest, target: URL | string): Promise<unknown> {
  switch (req.tool) {
    case "uptime":
      return uptime(ctx, target as URL);
    case "api":
      return api(ctx, target as URL, req.method);
    case "https":
      return https(ctx, target as URL);
    case "headers":
      return headers(ctx, target as URL);
    case "agents":
      return agents(ctx, target as URL);
    case "social":
      return social(ctx, target as URL);
    case "dns":
      return dns(ctx, target as string);
    case "domain":
      return domain(ctx, target as string);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const started = Date.now();
    const origin = request.headers.get("origin");
    const cors = corsHeaders(origin, env);
    const url = new URL(request.url);
    const enabled = list(env.TOOLS);

    if (url.pathname !== "/v1/check") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      return json(404, { error: "not_found" }, { ...cors, link: '<https://supercheck.io/tools/bot>; rel="help"' });
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (env.CHECKS_ENABLED !== "true" || !env.TURNSTILE_SECRET || enabled.length === 0) {
      return json(503, { error: "disabled" }, cors);
    }
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, { ...cors, allow: "POST, OPTIONS" });

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > BODY_CAP) return json(413, { error: "too_large" }, cors);
    const raw = await readCapped(request, BODY_CAP);
    if (raw.truncated) return json(413, { error: "too_large" }, cors);
    const parsed = parseBody(raw.text, enabled);
    if (!parsed.ok) {
      if (parsed.reason === "tool_disabled") return json(503, { error: "disabled" }, cors);
      return json(400, { error: "invalid_input", reason: parsed.reason }, cors);
    }
    const req = parsed.value;
    const log: CheckLog = { tool: req.tool, method: req.method, outcome: "pending", colo: colo(request) };
    const reply = (status: number, body: unknown, extra: HeadersInit = {}) => {
      log.durationMs = Date.now() - started;
      logCheck(log);
      return json(status, body, { ...cors, ...extra });
    };

    if (!originAllowed(origin, env)) {
      log.outcome = "origin_not_allowed";
      return reply(403, { error: "origin_not_allowed" });
    }

    const ip = request.headers.get("cf-connecting-ip");
    const bucket = ip ? ipBucket(ip) : null;
    if (!ip || !bucket) {
      log.outcome = "no_client_ip";
      return reply(403, { error: "forbidden" });
    }
    log.ipHash = await hashIp(bucket, env.IP_HASH_KEY);
    for (const [binding, retryAfter, name] of [
      [env.IP_BURST, 10, "ip_burst"],
      [env.IP_MINUTE, 60, "ip_minute"],
    ] as const) {
      if (!(await binding.limit({ key: bucket })).success) {
        log.outcome = "rate_limited";
        log.limit = name;
        return reply(429, { error: "rate_limited", retryAfter }, { "retry-after": String(retryAfter) });
      }
    }

    let target: URL | string;
    let site: string;
    if (DOMAIN_TOOLS.includes(req.tool)) {
      const policy = checkDomain(req.input, list(env.BLOCKED_HOSTS));
      if (!policy.ok) {
        log.outcome = "invalid_input";
        return reply(400, { error: "invalid_input", reason: policy.reason });
      }
      target = policy.value;
      site = registrable(policy.value);
      log.host = policy.value;
    } else {
      const policy = checkUrl(req.input, list(env.BLOCKED_HOSTS));
      if (!policy.ok) {
        log.outcome = "invalid_input";
        return reply(400, { error: "invalid_input", reason: policy.reason });
      }
      target = policy.value;
      site = registrable(policy.value.hostname);
      Object.assign(log, describeTarget(policy.value));
    }

    const deadline = AbortSignal.timeout(req.tool === "agents" ? 20_000 : 15_000);
    const ctx = new CheckContext(env, req.tool, deadline, req.tool === "agents" ? site : undefined);

    ctx.charge();
    log.turnstile = await verifyTurnstile(env, req.token, req.tool, ip);
    if (log.turnstile !== "ok") {
      log.outcome = "captcha_failed";
      return reply(403, { error: "captcha_failed" });
    }

    if (!(await env.TARGET_MINUTE.limit({ key: site })).success) {
      log.outcome = "rate_limited";
      log.limit = "target";
      return reply(429, { error: "rate_limited", retryAfter: 60 }, { "retry-after": "60" });
    }
    ctx.markCounted(site);

    const keyInput = typeof target === "string" ? target : target.toString();
    const key = await cacheKey(req.tool, req.method, keyInput);
    const hit = await cacheGet(ctx, key);
    if (hit) {
      log.outcome = "ok";
      log.cached = true;
      log.subrequests = ctx.subrequests;
      return reply(200, { ok: true, tool: req.tool, result: hit.result, checkedAt: hit.checkedAt, colo: log.colo, cached: true });
    }

    const checkedAt = new Date().toISOString();
    try {
      const result = await runTool(ctx, req, target);
      await cachePut(ctx, key, { result, checkedAt });
      log.outcome = "ok";
      log.cached = false;
      log.subrequests = ctx.subrequests;
      return reply(200, { ok: true, tool: req.tool, result, checkedAt, colo: log.colo, cached: false });
    } catch (error) {
      log.subrequests = ctx.subrequests;
      // Stops and our own errors are never cached.
      if (error instanceof CheckStop) {
        log.outcome = error.kind;
        log.limit = error.reason;
        return reply(200, { ok: true, tool: req.tool, result: { stopped: error.kind, reason: error.reason }, checkedAt, colo: log.colo, cached: false });
      }
      const timedOut = deadline.aborted;
      log.outcome = timedOut ? "timeout" : "error";
      return reply(200, {
        ok: true,
        tool: req.tool,
        result: { stopped: "limited", reason: timedOut ? "deadline" : "internal_error" },
        checkedAt,
        colo: log.colo,
        cached: false,
      });
    }
  },
} satisfies ExportedHandler<Env>;

function colo(request: Request): string | undefined {
  const value = (request as Request & { cf?: { colo?: unknown } }).cf?.colo;
  return typeof value === "string" ? value.slice(0, 8) : undefined;
}
