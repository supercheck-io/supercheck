// Site screenshots are plain public files cached for 7 days (public/_headers). Bump this whenever
// they are recaptured so browsers and CDNs fetch the new files. Docs MDX images are content-hashed
// by the build and need no version.
export const SCREENSHOT_VERSION = "2026-10-28";

/** Adds the screenshot version to local screenshot URLs; other URLs pass through unchanged. */
export function versioned(src: string): string {
  return src.startsWith("/screenshots/") || src === "/supercheck-screenshot.webp"
    ? `${src}?v=${SCREENSHOT_VERSION}`
    : src;
}

export const OG_IMAGE = versioned("/screenshots/playground-editor.png");
