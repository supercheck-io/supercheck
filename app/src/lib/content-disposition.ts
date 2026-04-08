const DEFAULT_FILENAME = "file";

function encodeRFC5987ValueChars(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function buildAsciiFilenameFallback(filename: string): string {
  const sanitized = filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "\\$&")
    .trim();

  return sanitized || DEFAULT_FILENAME;
}

export function buildContentDisposition(
  filename: string,
  disposition: "attachment" | "inline" = "attachment"
): string {
  const normalizedFileName = filename.trim() || DEFAULT_FILENAME;
  const asciiFallback = buildAsciiFilenameFallback(normalizedFileName);
  const encodedFileName = encodeRFC5987ValueChars(normalizedFileName);

  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedFileName}`;
}
