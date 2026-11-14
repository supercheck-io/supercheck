import { CheckContext, CheckStop, keptHeaders, walk } from "../context";
import { parseHsts } from "../grade";
import { getDomain } from "tldts";
import { registrable } from "../url-policy";

type Preload = "preloaded" | "pending" | "unknown" | "error";

/** Tool 3. A Worker cannot see the certificate, so a successful https fetch is the only signal. */
export async function https(ctx: CheckContext, url: URL) {
  const host = url.hostname;
  const site = registrable(host);

  const secure = await walk(ctx, new URL(`https://${host}/`), { maxHops: 3 });
  // Judge the checked host only: any response from it proves its handshake, whatever a
  // later redirect target does. Cloudflare answers a failed origin handshake with 525/526.
  const first = secure.first;
  const firstStatus = secure.ok && secure.hops.length === 0 ? secure.res.status : secure.hops[0]?.status;
  let certificateValid = first !== undefined;
  let certificateError: string | null = certificateValid ? null : secure.ok ? null : secure.error;
  if (firstStatus === 525 || firstStatus === 526) {
    certificateValid = false;
    certificateError = "tls_error";
    ctx.degraded = true;
  }
  // HSTS applies to the host that sent it; a redirect target's policy doesn't cover this one.
  const hstsHeader = first ? keptHeaders(first)["strict-transport-security"] : undefined;
  if (secure.ok) await secure.res.body?.cancel();

  // The http leg may run out of time; report it as not redirecting instead of losing the check.
  const plain = await walk(ctx, new URL(`http://${host}/`), { maxHops: 3 }).catch((error) => {
    if (error instanceof CheckStop && error.reason === "deadline") return { ok: false as const, error: "timeout", url: new URL(`http://${host}/`), hops: [], timeMs: 0 };
    throw error;
  });
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

  const parsed = parseHsts(hstsHeader);
  // max-age=0 tells browsers to forget HSTS: report it as off.
  const hsts = parsed && parsed.maxAge > 0 ? parsed : null;
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
    hstsDisabled: parsed?.maxAge === 0,
    preload,
  };
}
