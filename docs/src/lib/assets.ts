import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Site screenshots are plain public files cached for 7 days (public/_headers). Each URL carries a
// hash of the file's bytes, so a recaptured screenshot gets a new URL without a manual version bump.
// Docs MDX images are content-hashed by the build and do not go through this helper.
const hashes = new Map<string, string>();

function contentHash(src: string): string {
  let hash = hashes.get(src);
  if (!hash) {
    const bytes = readFileSync(join(process.cwd(), "public", src));
    hash = createHash("sha256").update(bytes).digest("hex").slice(0, 10);
    hashes.set(src, hash);
  }
  return hash;
}

/** Adds a content hash to local screenshot URLs; other URLs pass through unchanged. */
export function versioned(src: string): string {
  return src.startsWith("/screenshots/") || src === "/supercheck-screenshot.webp"
    ? `${src}?v=${contentHash(src)}`
    : src;
}

export const OG_IMAGE = versioned("/screenshots/playground-editor.png");
