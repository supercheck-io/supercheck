import { list, USER_AGENT, type Env, type Tool } from "./env";
import { isReservedIp } from "./ip-ranges";
import { checkUrl, registrable } from "./url-policy";

export const SUBREQUEST_BUDGET = 40;
const FETCH_TIMEOUT_MS = 5_000;
const DOH = "https://cloudflare-dns.com/dns-query";

/** Distinct hosts one check may touch (bounds the DoH column of the budget). */
export const HOST_CAP: Record<Tool, number> = {
  uptime: 6,
  headers: 6,
  api: 4,
  https: 4,
  social: 4,
  agents: 3,
  dns: 0,
  domain: 2,
};

export type StopKind = "blocked" | "blocked_redirect" | "limited";

/** Ends a check early with a reason the page can show. */
export class CheckStop extends Error {
  constructor(
    readonly kind: StopKind,
    readonly reason: string,
  ) {
    super(`${kind}: ${reason}`);
  }
}

export class CheckContext {
  subrequests = 0;
  private readonly hosts = new Set<string>();
  private readonly dns = new Map<string, Promise<string | null>>();
  private readonly counted = new Set<string>();
  readonly blocked: string[];

  constructor(
    readonly env: Env,
    readonly tool: Tool,
    readonly signal: AbortSignal,
    /** Agents hops must stay on this registrable domain. */
    readonly sameSite?: string,
  ) {
    this.blocked = list(env.BLOCKED_HOSTS);
  }

  /** Marks a registrable domain as already charged against the per-target limit. */
  markCounted(domain: string): void {
    this.counted.add(domain);
  }

  /** Charges one subrequest (fetch or Cache API call) against the budget. */
  charge(): void {
    if (this.subrequests >= SUBREQUEST_BUDGET) throw new CheckStop("limited", "subrequest_budget");
    this.subrequests += 1;
  }

  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    this.charge();
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);
    return fetch(url, { ...init, signal });
  }

  /** Rules 6-7 and the per-target limit for one host, before anything is fetched from it. */
  async vetHost(host: string, kind: StopKind): Promise<void> {
    const site = registrable(host);
    if (this.sameSite && site !== this.sameSite) throw new CheckStop("limited", "off_site_redirect");
    if (!this.hosts.has(host)) {
      if (this.hosts.size >= HOST_CAP[this.tool]) throw new CheckStop("limited", "too_many_hosts");
      this.hosts.add(host);
    }
    let pending = this.dns.get(host);
    if (!pending) {
      pending = this.resolveGuard(host);
      this.dns.set(host, pending);
    }
    const reason = await pending;
    if (reason) throw new CheckStop(kind, reason);
    if (!this.counted.has(site)) {
      this.counted.add(site);
      const { success } = await this.env.TARGET_MINUTE.limit({ key: site });
      if (!success) throw new CheckStop("limited", "target_rate_limited");
    }
  }

  /** DoH pre-check. Fails closed: any error or a name without A/AAAA blocks the host. */
  private async resolveGuard(host: string): Promise<string | null> {
    try {
      const answers = await Promise.all([this.doh(host, "A"), this.doh(host, "AAAA")]);
      const addresses = answers.flat();
      if (addresses.length === 0) return "no_address";
      return addresses.some(isReservedIp) ? "private_address" : null;
    } catch (error) {
      if (error instanceof CheckStop) throw error;
      return "dns_error";
    }
  }

  private async doh(host: string, type: "A" | "AAAA"): Promise<string[]> {
    const res = await this.fetch(`${DOH}?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
    });
    if (!res.ok) throw new Error("doh_http");
    const body = (await res.json()) as { Status?: number; Answer?: { type: number; data: string }[] };
    if (body.Status === 3) return [];
    if (body.Status !== 0) throw new Error("doh_status");
    const code = type === "A" ? 1 : 28;
    return (body.Answer ?? []).filter((a) => a.type === code).map((a) => a.data);
  }
}

export interface Hop {
  host: string;
  status: number;
}

export type Walk =
  | { ok: true; res: Response; url: URL; hops: Hop[]; timeMs: number }
  | { ok: false; error: string; url: URL; hops: Hop[]; timeMs: number };

/** Rule 8: follow redirects by hand, re-vetting every hop. */
export async function walk(
  ctx: CheckContext,
  start: URL,
  opts: { method?: "GET" | "HEAD"; maxHops: number },
): Promise<Walk> {
  let url = start;
  const hops: Hop[] = [];
  const t0 = Date.now();
  for (;;) {
    await ctx.vetHost(url.hostname, hops.length === 0 ? "blocked" : "blocked_redirect");
    let res: Response;
    try {
      res = await ctx.fetch(url.toString(), {
        method: opts.method ?? "GET",
        redirect: "manual",
        headers: { "user-agent": USER_AGENT },
      });
    } catch (error) {
      if (error instanceof CheckStop) throw error;
      return { ok: false, error: fetchErrorClass(error), url, hops, timeMs: Date.now() - t0 };
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) {
      return { ok: true, res, url, hops, timeMs: Date.now() - t0 };
    }
    await res.body?.cancel();
    hops.push({ host: url.hostname, status: res.status });
    if (hops.length > opts.maxHops) {
      return { ok: false, error: "too_many_redirects", url, hops, timeMs: Date.now() - t0 };
    }
    let next: string;
    try {
      next = new URL(location, url).toString();
    } catch {
      throw new CheckStop("blocked_redirect", "invalid_url");
    }
    const policy = checkUrl(next, ctx.blocked);
    if (!policy.ok) throw new CheckStop("blocked_redirect", policy.reason);
    url = policy.value;
  }
}

/** Maps a thrown fetch error to a short class. Certificate problems surface as thrown TypeErrors. */
export function fetchErrorClass(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (name === "TimeoutError" || name === "AbortError" || message.includes("timed out")) return "timeout";
  if (/cert|ssl|tls|handshake/.test(message)) return "tls_error";
  if (/dns|resolve|not found/.test(message)) return "dns_error";
  return "connection_failed";
}

/** Reads at most `cap` bytes of a body, then cancels the rest. */
export async function readCapped(res: { body: ReadableStream<Uint8Array> | null }, cap: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = cap - size;
    if (value.byteLength >= room) {
      chunks.push(value.subarray(0, room));
      size = cap;
      truncated = value.byteLength > room || !(await isDrained(reader));
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), truncated };
}

async function isDrained(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<boolean> {
  const { done, value } = await reader.read();
  return done || value.byteLength === 0;
}

export const KEPT_HEADERS = [
  "content-type",
  "content-length",
  "server",
  "cache-control",
  "strict-transport-security",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "cross-origin-embedder-policy",
  "access-control-allow-origin",
  "cf-mitigated",
  "x-robots-tag",
] as const;

const MAX_HEADER = 4096;

/** Allow-listed response headers only, each capped at 4 KB. Never set-cookie. */
export function keptHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of KEPT_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out[name] = value.slice(0, MAX_HEADER);
  }
  return out;
}
