// Pure helpers for the free tools pages: API call states, the "Monitor this" hand-off and share links.

export type ToolId = "uptime" | "api" | "https" | "headers" | "agents" | "dns" | "social" | "domain";
export type MonitorType = "website" | "http_request";

export const CHECKS_API_URL = process.env.NEXT_PUBLIC_CHECKS_API_URL ?? "";
export const TOOLS_SITE_KEY = process.env.NEXT_PUBLIC_TOOLS_TURNSTILE_SITE_KEY ?? "";
export const CLOUD_APP_URL = process.env.NEXT_PUBLIC_CLOUD_APP_URL || "https://app.supercheck.io";

export type CheckState =
  | { kind: "result"; result: Record<string, unknown>; checkedAt: string; colo: string | null; cached: boolean }
  | { kind: "invalid"; reason: string }
  | { kind: "captcha" }
  | { kind: "rate_limited"; retryAfter: number }
  | { kind: "disabled" }
  | { kind: "busy" };

/**
 * Maps the Worker's response to a page state. Anything that is not the Worker's JSON
 * (error 1027 when the daily cap is hit, an HTML error page, a network error) is "busy".
 */
export function toState(status: number, body: unknown): CheckState {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (status === 200 && b.ok === true && b.result && typeof b.result === "object") {
    return {
      kind: "result",
      result: b.result as Record<string, unknown>,
      checkedAt: typeof b.checkedAt === "string" ? b.checkedAt : new Date().toISOString(),
      colo: typeof b.colo === "string" ? b.colo : null,
      cached: b.cached === true,
    };
  }
  if (status === 400 && b.error === "invalid_input") return { kind: "invalid", reason: String(b.reason ?? "invalid_url") };
  if (status === 403 && b.error === "captcha_failed") return { kind: "captcha" };
  if (status === 429 && b.error === "rate_limited") {
    const retryAfter = Number(b.retryAfter);
    return { kind: "rate_limited", retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60 };
  }
  if (status === 503 && b.error === "disabled") return { kind: "disabled" };
  return { kind: "busy" };
}

const INVALID_COPY: Record<string, string> = {
  ip_literal: "IP addresses can't be checked. Enter a public domain like example.com.",
  port: "Only the standard ports 80 and 443 can be checked.",
  userinfo: "Remove the user name and password from the URL.",
  scheme: "Use an http:// or https:// address.",
  single_label: "Enter a full public domain like example.com.",
  reserved_name: "Private, reserved and Supercheck app names can't be checked.",
  blocked_host: "This site's owner has asked us not to check it.",
  missing_input: "Enter a URL or domain to check.",
};

export function invalidMessage(reason: string): string {
  return INVALID_COPY[reason] ?? "Enter a public domain like example.com. IP addresses, ports other than 80/443 and private names can't be checked.";
}

/** The monitor the CTA offers, built from what the visitor typed (never from target-controlled strings). */
export function monitorTarget(tool: ToolId, input: string, method: "GET" | "HEAD" = "GET"): { type: MonitorType; url: string; name: string; method?: "HEAD" } | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  const domainOnly = tool === "dns" || tool === "domain";
  const target = domainOnly ? `https://${url.hostname}/` : url.toString();
  return {
    type: tool === "api" ? "http_request" : "website",
    url: target,
    name: url.hostname,
    ...(tool === "api" && method === "HEAD" ? { method: "HEAD" as const } : {}),
  };
}

/**
 * Sign-in link that resumes at a pre-filled create form. The create path's values are encoded once,
 * then the whole path is encoded again, so after the browser decodes `next` the values stay encoded
 * (the app's sanitizeNextPath expects exactly this shape).
 */
export function monitorThisHref(tool: ToolId, input: string, method: "GET" | "HEAD" = "GET"): string {
  const t = monitorTarget(tool, input, method);
  if (!t) return `${CLOUD_APP_URL}/sign-in`;
  const path =
    `/monitors/create?type=${t.type}&url=${encodeURIComponent(t.url)}&name=${encodeURIComponent(t.name)}` +
    (t.method ? `&method=${t.method}` : "");
  return `${CLOUD_APP_URL}/sign-in?next=${encodeURIComponent(path)}`;
}

/** Share links only for inputs without a query string (queries can hold tokens) or userinfo. */
export function shareHref(slug: string, tool: ToolId, input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 512 || raw.includes("?") || raw.includes("@")) return null;
  const param = tool === "dns" || tool === "domain" ? "domain" : "url";
  return `/tools/${slug}?${param}=${encodeURIComponent(raw)}`;
}

/** Only https image URLs may be loaded in the visitor's browser, and only on click. */
export function loadableImage(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
