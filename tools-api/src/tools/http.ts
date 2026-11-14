import { CheckContext, keptHeaders, readCapped, walk } from "../context";
import { grade } from "../grade";

const BODY_CAP = 64 * 1024;

/** Tool 1: up when the final status after the hop cap is 200-299, the monitor default. */
export async function uptime(ctx: CheckContext, url: URL) {
  const r = await walk(ctx, url, { maxHops: 5 });
  if (!r.ok) return { up: false, error: r.error, timeMs: r.timeMs, finalUrl: r.url.toString(), hops: r.hops };
  await r.res.body?.cancel();
  const up = r.res.status >= 200 && r.res.status < 300;
  if (!up) ctx.degraded = true;
  return {
    up,
    status: r.res.status,
    timeMs: r.timeMs,
    finalUrl: r.url.toString(),
    hops: r.hops,
    server: r.res.headers.get("server")?.slice(0, 200) ?? null,
  };
}

/** Tool 2. */
export async function api(ctx: CheckContext, url: URL, method: "GET" | "HEAD") {
  const r = await walk(ctx, url, { method, maxHops: 3 });
  if (!r.ok) return { responding: false, error: r.error, timeMs: r.timeMs, hops: r.hops };
  const headers = keptHeaders(r.res.headers);
  const type = headers["content-type"] ?? null;
  let json: "valid" | "invalid" | "not_json" | "truncated" | "not_read" = "not_json";
  if (method === "HEAD") json = "not_read";
  else if (type && /json/i.test(type)) {
    const body = await readCapped(r.res, BODY_CAP);
    if (body.interrupted) ctx.degraded = true;
    if (body.truncated) json = "truncated";
    else {
      try {
        JSON.parse(body.text);
        json = "valid";
      } catch {
        json = "invalid";
      }
    }
  }
  await r.res.body?.cancel().catch(() => undefined);
  if (r.res.status >= 500) ctx.degraded = true;
  return {
    responding: r.res.status < 500,
    status: r.res.status,
    timeMs: r.timeMs,
    contentType: type,
    json,
    cors: headers["access-control-allow-origin"] ?? null,
    cacheControl: headers["cache-control"] ?? null,
    hops: r.hops,
  };
}

/** Tool 4: same fetch as uptime, graded on the final response's headers. */
export async function headers(ctx: CheckContext, url: URL) {
  const r = await walk(ctx, url, { maxHops: 5 });
  if (!r.ok) return { error: r.error, finalUrl: r.url.toString(), hops: r.hops };
  await r.res.body?.cancel();
  // Grade the full values (a long CSP keeps its trailing directives); show capped ones.
  const graded = grade(keptHeaders(r.res.headers, Infinity), r.url.protocol === "https:");
  return {
    status: r.res.status,
    finalUrl: r.url.toString(),
    hops: r.hops,
    headers: keptHeaders(r.res.headers),
    ...graded,
    rows: graded.rows.map((row) => ({ ...row, value: row.value?.slice(0, 4096) ?? null })),
  };
}
