import type { CheckContext } from "./context";

const TTL_SECONDS = 600;

/** Synthetic GET key: the Cache API cannot match HEAD, so the method is part of the path. */
export async function cacheKey(tool: string, method: string, input: string): Promise<Request> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request(`https://cache.invalid/v1/${tool}/${method}/${hex}`);
}

export interface Cached {
  result: unknown;
  checkedAt: string;
}

/** Best effort: may be a no-op on workers.dev. Each call costs one subrequest. */
export async function cacheGet(ctx: CheckContext, key: Request): Promise<Cached | null> {
  try {
    ctx.charge();
    const hit = await caches.default.match(key);
    return hit ? ((await hit.json()) as Cached) : null;
  } catch {
    return null;
  }
}

export async function cachePut(ctx: CheckContext, key: Request, value: Cached): Promise<void> {
  try {
    ctx.charge();
    await caches.default.put(
      key,
      new Response(JSON.stringify(value), { headers: { "content-type": "application/json", "cache-control": `max-age=${TTL_SECONDS}` } }),
    );
  } catch {
    // Cache failures never fail a check.
  }
}
