import crypto from "node:crypto";
import { deriveSigningKey } from "@/lib/security/secret-crypto";

/**
 * Optional separate, cookieless origin for generated report documents (REPORTS_ORIGIN).
 * Unset = reports are served from the app origin exactly as before.
 */

const TOKEN_PREFIX = "~";
export const REPORT_TOKEN_TTL_SECONDS = 60 * 60;
const SIGNING_CONTEXT = "reports-origin-url-v1";

export function getReportsOrigin(): string | null {
  const raw = process.env.REPORTS_ORIGIN?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // Same host as the app would route every app request to the reports host and lock the app out.
    const appHost = getAppOrigin() && new URL(getAppOrigin()!).host;
    if (appHost && appHost === url.host) {
      console.error("[REPORTS_ORIGIN] Ignoring REPORTS_ORIGIN: it must differ from the app origin");
      return null;
    }
    return url.origin;
  } catch {
    console.error("[REPORTS_ORIGIN] Ignoring invalid REPORTS_ORIGIN value");
    return null;
  }
}

/** The app's own origin, the only one allowed to embed reports. */
export function getAppOrigin(): string | null {
  try {
    return new URL(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").origin;
  } catch {
    return null;
  }
}

/**
 * Fail closed: a request is on the reports host if Host OR X-Forwarded-Host names it, so a report script
 * cannot dodge the host gate by forging X-Forwarded-Host.
 */
export function hostsOfRequest(headers: Headers, url: string): string[] {
  return [headers.get("x-forwarded-host"), headers.get("host"), new URL(url).host]
    .flatMap((h) => (h ? h.split(",") : []))
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function isReportsHost(request: Request): boolean {
  const origin = getReportsOrigin();
  if (!origin) return false;
  const reportsHost = new URL(origin).host.toLowerCase();
  return hostsOfRequest(request.headers, request.url).includes(reportsHost);
}

type ReportTokenPayload = { e: string; p: string; x: number };

function sign(body: string): string {
  return crypto
    .createHmac("sha256", deriveSigningKey(SIGNING_CONTEXT))
    .update(body)
    .digest("base64url");
}

/** Token bound to one report entity and its project; `~` marks it as a path segment. */
export function mintReportToken(
  entityId: string,
  projectId: string,
  now: number = Date.now(),
  ttlSeconds: number = REPORT_TOKEN_TTL_SECONDS
): string {
  const payload: ReportTokenPayload = {
    e: entityId,
    p: projectId,
    x: Math.floor(now / 1000) + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${TOKEN_PREFIX}${body}.${sign(body)}`;
}

export function isReportToken(segment: string | undefined): segment is string {
  return !!segment && segment.startsWith(TOKEN_PREFIX);
}

/** Returns the bound project id when the token is authentic, unexpired and for this entity. */
export function verifyReportToken(
  token: string,
  entityId: string,
  now: number = Date.now()
): { projectId: string } | null {
  if (!isReportToken(token)) return null;
  const [body, signature, ...rest] = token.slice(TOKEN_PREFIX.length).split(".");
  if (!body || !signature || rest.length) return null;
  try {
    const expected = Buffer.from(sign(body));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ReportTokenPayload;
    if (
      payload.e !== entityId ||
      typeof payload.p !== "string" ||
      typeof payload.x !== "number" ||
      payload.x <= Math.floor(now / 1000)
    ) {
      return null;
    }
    return { projectId: payload.p };
  } catch {
    return null;
  }
}

/** `/api/test-results/<rest>` -> `<reports origin>/api/test-results/~token/<rest>`. */
export function buildReportUrl(origin: string, token: string, rest: string): string {
  return `${origin}/api/test-results/${token}/${rest.replace(/^\/+/, "")}`;
}
