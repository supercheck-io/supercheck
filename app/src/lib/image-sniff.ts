import { detectAvatarType } from "@/lib/user-avatar";

/** Index just past the XML declaration, comments and DOCTYPE before the root element; -1 if malformed. Linear time. */
function skipXmlProlog(doc: string): number {
  let i = 0;
  for (;;) {
    while (i < doc.length && /\s/.test(doc[i])) i++;
    if (doc.startsWith("<?", i)) {
      const end = doc.indexOf("?>", i + 2);
      if (end < 0) return -1;
      i = end + 2;
    } else if (doc.startsWith("<!--", i)) {
      const end = doc.indexOf("-->", i + 4);
      if (end < 0) return -1;
      i = end + 3;
    } else if (doc.slice(i, i + 9).toUpperCase() === "<!DOCTYPE") {
      // Single pass: '>' ends the DOCTYPE only outside quotes and outside the [internal subset].
      let quote = "";
      let inSubset = false;
      for (i += 9; i < doc.length; i++) {
        const c = doc[i];
        if (quote) { if (c === quote) quote = ""; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === "[") inSubset = true;
        else if (c === "]") inSubset = false;
        else if (c === ">" && !inSubset) break;
      }
      if (i >= doc.length) return -1;
      i++;
    } else {
      return i;
    }
  }
}

// The declared MIME is client-controlled; the bytes must match its image family.
export function sniffImageType(b: Uint8Array): string | null {
  const raster = detectAvatarType(b);
  if (raster) return raster === "jpg" ? "image/jpeg" : `image/${raster}`;
  if (b.length >= 6 && /^GIF8[79]a$/.test(Buffer.from(b.subarray(0, 6)).toString("latin1"))) return "image/gif";
  // SVG: the document root element must be <svg> (Illustrator/Inkscape put long entity blocks before it).
  const doc = Buffer.from(b).toString("utf8").replace(/^﻿/, "");
  const root = skipXmlProlog(doc);
  if (root >= 0 && /^<svg[\s>/]/.test(doc.slice(root, root + 5))) return "image/svg+xml";
  return null;
}
