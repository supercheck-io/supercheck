import { CheckContext, keptHeaders, walk } from "../context";
import { parseHsts } from "../grade";
import { getDomain } from "tldts";
import { registrable } from "../url-policy";

type Preload = "preloaded" | "pending" | "unknown" | "error";

/** Tool 3. A Worker cannot see the certificate, so a successful https fetch is the only signal. */
export async function https(ctx: CheckContext, url: URL) {
  const host = url.hostname;
  const site = registrable(host);

  const secure = await walk(ctx, new URL(`https://${host}/`), { maxHops: 3 });
  let certificateValid = secure.ok;
  let certificateError: string | null = secure.ok ? null : secure.error;
  // A redirect loop still proved the handshake worked.
  if (!secure.ok && secure.error === "too_many_redirects") {
    certificateValid = true;
    certificateError = null;
  }
  const hstsHeader =
    secure.ok && secure.url.protocol === "https:" ? keptHeaders(secure.res.headers)["strict-transport-security"] : undefined;
  if (secure.ok) await secure.res.body?.cancel();

  const plain = await walk(ctx, new URL(`http://${host}/`), { maxHops: 3 });
  const redirectsToHttps = plain.ok && plain.url.protocol === "https:" && registrable(plain.url.hostname) === site;
  if (plain.ok) await plain.res.body?.cancel();

  let preload: Preload;
  try {
    const res = await ctx.fetch(`https://hstspreload.org/api/v2/status?domain=${encodeURIComponent(getDomain(host) ?? host)}`);
    const body = (await res.json()) as { status?: string };
    preload = body.status === "preloaded" || body.status === "pending" ? body.status : "unknown";
  } catch {
    preload = "error";
  }

  const hsts = parseHsts(hstsHeader);
  const problems = [!certificateValid, !redirectsToHttps, !hsts].filter(Boolean).length;
  return {
    ok: problems === 0,
    problems,
    certificateValid,
    certificateError,
    redirectsToHttps,
    httpHops: plain.hops,
    hsts: hsts ? { ...hsts, maxAgeDays: Math.floor(hsts.maxAge / 86_400) } : null,
    hstsHeader: hstsHeader ?? null,
    preload,
  };
}
