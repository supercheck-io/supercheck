import { list, type Env, type Tool } from "./env";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Label-boundary suffix match: www.supercheck.io passes, evilsupercheck.io does not. */
export function hostnameAllowed(hostname: string, allowed: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export type Verdict = "ok" | "fail";

export async function verifyTurnstile(env: Env, token: string, tool: Tool, ip: string): Promise<Verdict> {
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
  return hostnameAllowed(body.hostname ?? "", list(env.TURNSTILE_HOSTNAMES)) ? "ok" : "fail";
}
