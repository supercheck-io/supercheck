import { env } from "cloudflare:workers";
import { vi } from "vitest";
import worker from "./index";
import { CheckContext } from "./context";
import type { Env, Tool } from "./env";

// The default siteverify mock answers for the tool of the last call().
let currentTool = "uptime";

type Handler = (req: Request) => Response | Promise<Response>;

/** Routes outbound fetches by URL prefix. DoH answers public addresses unless overridden. */
export function mockFetch(routes: Record<string, Handler | Response> = {}, doh: Record<string, string[]> = {}) {
  const calls: Request[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    calls.push(req);
    const url = req.url;
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
      const u = new URL(url);
      const name = u.searchParams.get("name")!;
      const type = u.searchParams.get("type")!;
      const route = routes[`doh:${name}:${type}`] ?? routes[`doh:${name}`];
      if (route) return typeof route === "function" ? route(req) : route.clone();
      const ips = doh[name] ?? (type === "A" ? ["93.184.215.14"] : []);
      const code = type === "A" ? 1 : type === "AAAA" ? 28 : 0;
      const answers = ips.filter((ip) => (code === 1 ? !ip.includes(":") : ip.includes(":"))).map((data) => ({ name, type: code, TTL: 60, data }));
      return Response.json({ Status: 0, AD: false, Answer: answers });
    }
    if (url.startsWith("https://challenges.cloudflare.com/turnstile")) {
      const route = routes["turnstile"];
      if (route) return typeof route === "function" ? route(req) : route.clone();
      return Response.json({ success: true, action: currentTool, hostname: "supercheck.io" });
    }
    const key = Object.keys(routes)
      .filter((k) => url.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) return new Response("not mocked", { status: 599 });
    const route = routes[key];
    return typeof route === "function" ? route(req) : route.clone();
  });
  return { calls, spy, targets: () => calls.filter((c) => !/cloudflare-dns\.com|challenges\.cloudflare\.com/.test(c.url)) };
}

export function redirect(location: string, status = 301): Response {
  return new Response(null, { status, headers: { location } });
}

/** Never-limiting stand-ins for the rate-limit bindings, for unit tests. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  const open = { limit: async () => ({ success: true }) } as unknown as RateLimit;
  return { IP_MINUTE: open, IP_BURST: open, TARGET_MINUTE: open, BLOCKED_HOSTS: "", ...overrides };
}

export function ctxFor(tool: Tool, env: Env = testEnv(), sameSite?: string): CheckContext {
  return new CheckContext(env, tool, AbortSignal.timeout(15_000), sameSite);
}

export const ORIGIN = "https://supercheck.io";
let ipSeq = 0;

export function call(body: unknown, opts: { env?: Partial<Env>; headers?: Record<string, string>; method?: string; path?: string } = {}) {
  ipSeq += 1;
  const tool = (body as { tool?: unknown } | null)?.tool;
  if (typeof tool === "string") currentTool = tool;
  const headers: Record<string, string> = {
    origin: ORIGIN,
    "content-type": "text/plain;charset=UTF-8",
    "cf-connecting-ip": `198.51.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`.replace(/^198\.51\./, "203.0."),
    ...opts.headers,
  };
  for (const [k, v] of Object.entries(headers)) if (v === "") delete headers[k];
  const method = opts.method ?? "POST";
  const req = new Request(`https://supercheck-tools.x.workers.dev${opts.path ?? "/v1/check"}`, {
    method,
    headers,
    body: method === "POST" || method === "PUT" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  return worker.fetch(req, { ...(env as unknown as Env), ...testEnv(), ...opts.env } as Env);
}

