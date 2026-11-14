import { getDomain, getPublicSuffix } from "tldts";
import { CheckContext, CheckStop, readCapped } from "../context";
import { checkUrl } from "../url-policy";

const BOOTSTRAP = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
const RDAP_CAP = 64 * 1024;

let bootstrap: { at: number; services: Map<string, string> } | null = null;

/** Test hook: the bootstrap is cached per isolate. */
export function resetBootstrap(): void {
  bootstrap = null;
}

async function rdapBase(ctx: CheckContext, tld: string): Promise<string | null> {
  if (!bootstrap || Date.now() - bootstrap.at > BOOTSTRAP_TTL_MS) {
    const res = await ctx.fetch(BOOTSTRAP);
    if (!res.ok) throw new Error("bootstrap_unavailable");
    const body = (await res.json()) as { services: [string[], string[]][] };
    const services = new Map<string, string>();
    for (const [tlds, urls] of body.services) {
      const base = urls.find((u) => u.startsWith("https://"));
      if (base) for (const t of tlds) services.set(t.toLowerCase(), base.endsWith("/") ? base : `${base}/`);
    }
    bootstrap = { at: Date.now(), services };
  }
  return bootstrap.services.get(tld) ?? null;
}

interface Rdap {
  events?: { eventAction?: string; eventDate?: string }[];
  entities?: { roles?: string[]; vcardArray?: [string, [string, unknown, string, unknown][]] }[];
  status?: string[];
  links?: { rel?: string; href?: string; type?: string }[];
}

async function getRdap(ctx: CheckContext, url: string): Promise<{ status: number; body: Rdap | null }> {
  const res = await ctx.fetch(url, { headers: { accept: "application/rdap+json" }, redirect: "manual" });
  if (res.status !== 200) {
    await res.body?.cancel();
    return { status: res.status, body: null };
  }
  const { text, truncated } = await readCapped(res, RDAP_CAP);
  if (truncated) return { status: 200, body: null };
  try {
    return { status: 200, body: JSON.parse(text) as Rdap };
  } catch {
    return { status: 200, body: null };
  }
}

function expiry(body: Rdap): string | null {
  const date = body.events?.find((e) => e.eventAction === "expiration")?.eventDate;
  return date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null;
}

function registrar(body: Rdap): string | null {
  const entity = body.entities?.find((e) => e.roles?.includes("registrar"));
  const fn = entity?.vcardArray?.[1]?.find((field) => field[0] === "fn")?.[3];
  return typeof fn === "string" ? fn.slice(0, 200) : null;
}

/** Tool 8: registration data from RDAP only; no data means "not available", never a guess. */
export async function domain(ctx: CheckContext, host: string) {
  // The registry knows example.github.io as github.io: ICANN suffixes only here.
  const name = getDomain(host) ?? host;
  const tld = (getPublicSuffix(name) ?? "").split(".").pop() ?? "";
  const base = await rdapBase(ctx, tld);
  if (!base) return { domain: name, hasData: false, reason: "no_rdap_service", tld };

  const primary = await getRdap(ctx, `${base}domain/${encodeURIComponent(name)}`);
  if (primary.status === 404) return { domain: name, hasData: false, reason: "not_found", tld, server: base };
  if (!primary.body) return { domain: name, hasData: false, reason: "rdap_error", tld, server: base };

  let expires = expiry(primary.body);
  let registrarName = registrar(primary.body);
  let server = base;
  if (!expires) {
    // The registry may defer to the registrar; follow at most one untrusted link.
    const related = primary.body.links?.find((l) => l.rel === "related" && typeof l.href === "string")?.href;
    const policy = related ? checkUrl(related, ctx.blocked) : null;
    if (policy?.ok && policy.value.protocol === "https:") {
      try {
        await ctx.vetHost(policy.value.hostname, "blocked");
        const second = await getRdap(ctx, policy.value.toString());
        if (second.body) {
          expires = expiry(second.body);
          registrarName ??= registrar(second.body);
          server = policy.value.origin + "/";
        }
      } catch (error) {
        if (!(error instanceof CheckStop) || error.reason === "subrequest_budget") throw error;
      }
    }
  }

  const daysLeft = expires ? Math.floor((Date.parse(expires) - Date.now()) / 86_400_000) : null;
  return {
    domain: name,
    hasData: expires !== null,
    reason: expires ? null : "no_expiry_published",
    tld,
    expires,
    daysLeft,
    expired: daysLeft !== null && daysLeft < 0,
    registrar: registrarName,
    statuses: (primary.body.status ?? []).filter((s) => typeof s === "string").slice(0, 20).map((s) => s.slice(0, 100)),
    server,
  };
}
