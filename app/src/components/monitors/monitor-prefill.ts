/**
 * Pre-fill for a new monitor from the URL (the free tools' "Monitor this" hand-off):
 * `?type=website|http_request&url=…&name=…&method=GET|HEAD`.
 * Values only go into form fields; the form's schema and the server's target policy
 * validate them on submit, and nothing here navigates to or renders the URL as HTML.
 */
export interface MonitorPrefill {
  target?: string;
  name?: string;
  httpConfig_method?: "GET" | "HEAD";
  websiteConfig_enableSslCheck?: boolean;
}

export function monitorPrefill(params: Pick<URLSearchParams, "get"> | null | undefined, type: string): MonitorPrefill {
  if (!params || (type !== "website" && type !== "http_request")) return {};
  const out: MonitorPrefill = {};
  const url = params.get("url");
  if (url && url.length <= 2048 && /^https?:\/\//i.test(url)) {
    out.target = url;
    // The free tools promise certificate expiry alerts, which is the website monitor's SSL check.
    if (type === "website" && /^https:/i.test(url)) out.websiteConfig_enableSslCheck = true;
  }
  const name = params.get("name")?.trim();
  if (name) out.name = name.slice(0, 100);
  const method = params.get("method");
  if (type === "http_request" && (method === "GET" || method === "HEAD")) out.httpConfig_method = method;
  return out;
}

/**
 * A saved wizard draft yields to an explicit hand-off for another target, so "Monitor this"
 * never opens an older, unrelated draft. Returns the draft to restore, or undefined.
 */
export function draftForHandoff<T extends { target?: unknown }>(draft: T | undefined, handoffUrl: string | null | undefined): T | undefined {
  if (!draft) return undefined;
  return handoffUrl && draft.target !== handoffUrl ? undefined : draft;
}
