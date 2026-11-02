import { detectAvatarType } from "@/lib/user-avatar";

// The declared MIME is client-controlled; the bytes must match its image family.
export function sniffImageType(b: Uint8Array): string | null {
  const raster = detectAvatarType(b);
  if (raster) return raster === "jpg" ? "image/jpeg" : `image/${raster}`;
  if (b.length >= 6 && [0x47, 0x49, 0x46, 0x38].every((v, i) => b[i] === v)) return "image/gif";
  const head = Buffer.from(b.subarray(0, 1024)).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if ((head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<!--") || /^<!doctype svg/i.test(head)) && head.includes("<svg")) {
    return "image/svg+xml";
  }
  return null;
}
