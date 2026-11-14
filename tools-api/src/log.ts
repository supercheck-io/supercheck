export interface CheckLog {
  tool: string;
  method?: string;
  host?: string;
  pathPrefix?: string;
  ipHash?: string;
  colo?: string;
  cached?: boolean;
  turnstile?: "ok" | "fail" | "skip";
  limit?: string;
  outcome: string;
  subrequests?: number;
  durationMs?: number;
}

/** Host plus the first path segment only: never the full path, query, IP or token. */
export function describeTarget(url: URL | null): { host?: string; pathPrefix?: string } {
  if (!url) return {};
  return { host: url.hostname, pathPrefix: `/${url.pathname.split("/")[1] ?? ""}`.slice(0, 32) };
}

export async function hashIp(bucket: string, key: string | undefined): Promise<string | undefined> {
  if (!key) return undefined;
  const hmacKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(bucket));
  return [...new Uint8Array(sig).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function logCheck(entry: CheckLog): void {
  console.log(JSON.stringify({ event: "check", ...entry }));
}
