import { detectAvatarType } from "@/lib/user-avatar";

// The declared MIME is client-controlled; the bytes must match its image family.
export function sniffImageType(b: Uint8Array): string | null {
  const raster = detectAvatarType(b);
  if (raster) return raster === "jpg" ? "image/jpeg" : `image/${raster}`;
  if (b.length >= 6 && [0x47, 0x49, 0x46, 0x38].every((v, i) => b[i] === v)) return "image/gif";
  // Illustrator/Inkscape exports can put a long DOCTYPE/entity block or licence comment before <svg.
  const head = Buffer.from(b.subarray(0, 8192)).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (head.startsWith("<") && /<svg[\s>/]/.test(head) && !/<html[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}
