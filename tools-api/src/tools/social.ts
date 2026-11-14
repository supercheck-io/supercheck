import { CheckContext, CheckStop, walk } from "../context";
import { checkUrl } from "../url-policy";

const HEAD_CAP = 64 * 1024;
const TEXT_CAP = 300;
const URL_CAP = 2048;
export const SOCIAL_TAGS = [
  "og:title",
  "og:description",
  "og:image",
  "og:url",
  "og:type",
  "twitter:card",
  "twitter:title",
  "twitter:description",
  "twitter:image",
] as const;

export interface SocialTags {
  tags: Record<string, string>;
  title: string | null;
  description: string | null;
  truncated: boolean;
  interrupted?: boolean;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

/** HTMLRewriter hands attribute values over as written; decode character references once. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, ref: string) => {
    if (ref[0] !== "#") return NAMED[ref.toLowerCase()] ?? m;
    const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : m;
  });
}

/** Extracts head metadata, stopping at </head> or after 64 KB of HTML. */
export async function extractHead(res: Response): Promise<SocialTags> {
  const tags: Record<string, string> = {};
  let title = "";
  let inTitle = false;
  let description: string | null = null;
  let done = false;

  const rewriter = new HTMLRewriter()
    .on("meta", {
      element(el) {
        if (done) return;
        const key = (el.getAttribute("property") ?? el.getAttribute("name") ?? "").toLowerCase();
        const raw = el.getAttribute("content");
        if (raw === null) return;
        const content = decodeEntities(raw);
        // Image URLs keep their full length (signed CDN URLs); display text is capped.
        const cap = key === "og:image" || key === "twitter:image" ? URL_CAP : TEXT_CAP;
        if ((SOCIAL_TAGS as readonly string[]).includes(key) && !(key in tags)) tags[key] = content.slice(0, cap);
        if (key === "description" && description === null) description = content.slice(0, TEXT_CAP);
      },
    })
    .on("title", {
      element(el) {
        inTitle = true;
        el.onEndTag(() => {
          inTitle = false;
        });
      },
      text(chunk) {
        if (inTitle && !done && title.length < TEXT_CAP) title += chunk.text;
      },
    })
    .on("head", {
      element(el) {
        el.onEndTag(() => {
          done = true;
        });
      },
    })
    .on("body", {
      element() {
        done = true;
      },
    })
    .onDocument({
      end() {
        done = true;
      },
    });

  // Feed at most HEAD_CAP bytes, stopping as soon as the head is over.
  const capped = capStream(res, HEAD_CAP, () => done);
  const out = rewriter.transform(new Response(capped.stream));
  let interrupted = false;
  try {
    await out.body?.pipeTo(new WritableStream());
  } catch {
    // A body that stalls or drops: keep what the head gave us.
    interrupted = true;
  }
  return {
    tags,
    title: title.trim().slice(0, TEXT_CAP) || null,
    description,
    truncated: capped.truncated() || interrupted,
    ...(interrupted ? { interrupted } : {}),
  };
}

function capStream(res: Response, cap: number, stop: () => boolean) {
  let size = 0;
  let truncated = false;
  const reader = res.body?.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!reader || stop()) {
        await reader?.cancel().catch(() => undefined);
        controller.close();
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      const room = cap - size;
      if (value.byteLength >= room) {
        controller.enqueue(value.subarray(0, room));
        size = cap;
        truncated = true;
        await reader.cancel().catch(() => undefined);
        controller.close();
        return;
      }
      size += value.byteLength;
      controller.enqueue(value);
    },
  });
  return { stream, truncated: () => truncated };
}

/** Tool 7. */
export async function social(ctx: CheckContext, url: URL) {
  const r = await walk(ctx, url, { maxHops: 3 });
  if (!r.ok) return { error: r.error, hops: r.hops };
  const head = await extractHead(r.res);
  if (head.interrupted) ctx.degraded = true;
  const missing = SOCIAL_TAGS.filter((tag) => !(tag in head.tags));
  const image = head.tags["og:image"] ? await checkImage(ctx, head.tags["og:image"], r.url) : null;
  return {
    status: r.res.status,
    finalUrl: r.url.toString(),
    ...head,
    missing,
    image,
  };
}

async function checkImage(ctx: CheckContext, raw: string, base: URL) {
  let resolved: string;
  try {
    resolved = new URL(raw, base).toString();
  } catch {
    return { url: raw.slice(0, TEXT_CAP), reachable: false, reason: "invalid_url" };
  }
  const shown = resolved.slice(0, 2048);
  const policy = checkUrl(resolved, ctx.blocked);
  if (!policy.ok) return { url: shown, reachable: false, reason: policy.reason, loadable: false };
  const loadable = policy.value.protocol === "https:";
  try {
    let r = await walk(ctx, policy.value, { method: "HEAD", maxHops: 3 });
    // Many CDNs and object stores refuse HEAD; ask for one byte with GET instead.
    if (r.ok && [403, 405, 501].includes(r.res.status)) {
      await r.res.body?.cancel();
      r = await walk(ctx, policy.value, { method: "GET", maxHops: 3, headers: { range: "bytes=0-0" } });
    }
    if (!r.ok) return { url: shown, reachable: false, reason: r.error, loadable };
    await r.res.body?.cancel();
    // A browser blocks an https page's image that ends on http, redirects included.
    const loadableAfterRedirects = loadable && r.url.protocol === "https:";
    const type = r.res.headers.get("content-type")?.slice(0, 100) ?? null;
    // After the ranged GET fallback, content-length is 1: the full size is after the "/" in content-range.
    const range = r.res.headers.get("content-range")?.match(/\/(\d+)$/);
    const length = r.res.status === 206 ? (range ? Number(range[1]) : null) : Number(r.res.headers.get("content-length")) || null;
    const isImage = !!type && /^image\//i.test(type);
    const okStatus = r.res.status >= 200 && r.res.status < 300;
    if (!okStatus) ctx.degraded = true;
    return {
      url: shown,
      reachable: okStatus && isImage,
      reason: !okStatus ? `http_${r.res.status}` : isImage ? null : "not_an_image",
      contentType: type,
      bytes: length,
      loadable: loadableAfterRedirects,
    };
  } catch (error) {
    if (!(error instanceof CheckStop)) throw error;
    // A blocked image hop never fails the whole check; it is reported unreachable.
    if (error.reason === "subrequest_budget") throw error;
    ctx.degraded = true;
    // Out of time: keep the parsed tags; the image just wasn't checked.
    if (error.reason === "deadline") return { url: shown, reachable: false, reason: "timeout", loadable };
    return { url: shown, reachable: false, reason: error.reason, loadable: false };
  }
}
