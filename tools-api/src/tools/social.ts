import { CheckContext, CheckStop, walk } from "../context";
import { checkUrl } from "../url-policy";

const HEAD_CAP = 64 * 1024;
const TEXT_CAP = 300;
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
        const content = el.getAttribute("content");
        if (content === null) return;
        if ((SOCIAL_TAGS as readonly string[]).includes(key) && !(key in tags)) tags[key] = content.slice(0, TEXT_CAP);
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
  await out.body?.pipeTo(new WritableStream());
  return {
    tags,
    title: title.trim().slice(0, TEXT_CAP) || null,
    description,
    truncated: capped.truncated(),
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
    const r = await walk(ctx, policy.value, { method: "HEAD", maxHops: 3 });
    if (!r.ok) return { url: shown, reachable: false, reason: r.error, loadable };
    await r.res.body?.cancel();
    const type = r.res.headers.get("content-type")?.slice(0, 100) ?? null;
    const length = Number(r.res.headers.get("content-length")) || null;
    const isImage = !!type && /^image\//i.test(type);
    return {
      url: shown,
      reachable: r.res.status >= 200 && r.res.status < 300 && isImage,
      reason: isImage ? null : "not_an_image",
      contentType: type,
      bytes: length,
      loadable,
    };
  } catch (error) {
    if (!(error instanceof CheckStop)) throw error;
    // A blocked image hop never fails the whole check; it is reported unreachable.
    if (error.reason === "subrequest_budget") throw error;
    return { url: shown, reachable: false, reason: error.reason, loadable: false };
  }
}
