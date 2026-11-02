import { detectAvatarType } from "@/lib/user-avatar";

// The declared MIME is client-controlled; the bytes must match its image family.
export function sniffImageType(b: Uint8Array): string | null {
  const raster = detectAvatarType(b);
  if (raster) return raster === "jpg" ? "image/jpeg" : `image/${raster}`;
  if (b.length >= 6 && /^GIF8[79]a$/.test(Buffer.from(b.subarray(0, 6)).toString("latin1"))) return "image/gif";
  // SVG: the document root element must be <svg>, after any XML declaration, comments and DOCTYPE
  // (Illustrator/Inkscape exports can put long entity blocks there).
  let doc = Buffer.from(b).toString("utf8").replace(/^\uFEFF/, "");
  for (;;) {
    doc = doc.trimStart();
    const prolog = /^(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE(?:[^[>]*\[[\s\S]*?\])?[^>]*>)/i.exec(doc);
    if (!prolog) break;
    doc = doc.slice(prolog[0].length);
  }
  if (/^<svg[\s>/]/.test(doc)) return "image/svg+xml";
  return null;
}
