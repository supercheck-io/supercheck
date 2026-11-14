export const TOOLS = ["uptime", "api", "https", "headers", "agents", "dns", "social", "domain"] as const;
export type Tool = (typeof TOOLS)[number];

export interface Env {
  CHECKS_ENABLED?: string;
  TOOLS?: string;
  ALLOWED_ORIGINS?: string;
  ALLOW_PREVIEW_ORIGINS?: string;
  TURNSTILE_HOSTNAMES?: string;
  BLOCKED_HOSTS?: string;
  TURNSTILE_SECRET?: string;
  IP_HASH_KEY?: string;
  IP_MINUTE: RateLimit;
  IP_BURST: RateLimit;
  TARGET_MINUTE: RateLimit;
}

export const USER_AGENT = "SupercheckBot/1.0 (+https://supercheck.io/tools/bot)";

export function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}
