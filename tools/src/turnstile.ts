import type { Env, Tool } from "./env";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Exact match, so a token minted on some other subdomain is refused. A leading dot (".supercheck.pages.dev")
 * opts that entry into label-boundary suffix matching, for preview deploys.
 */
export function hostnameAllowed(hostname: string, allowed: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowed.some((entry) => (entry.startsWith(".") ? host.endsWith(entry) : host === entry));
}

export type Verdict = "ok" | "fail";

export async function verifyTurnstile(env: Env, token: string, tool: Tool, ip: string, hostnames: string[]): Promise<Verdict> {
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET ?? "");
  form.set("response", token);
  form.set("remoteip", ip);
  let body: { success?: boolean; action?: string; hostname?: string };
  try {
    const res = await fetch(SITEVERIFY, { method: "POST", body: form, signal: AbortSignal.timeout(5_000) });
    body = await res.json();
  } catch {
    return "fail";
  }
  if (body.success !== true) return "fail";
  if (body.action !== tool) return "fail";
  return hostnameAllowed(body.hostname ?? "", hostnames) ? "ok" : "fail";
}
