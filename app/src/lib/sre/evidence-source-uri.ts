export function isSafeEvidenceSourceUri(value: string) {
  // Reject browser-normalized paths and embedded credentials before navigation.
  if (/[\u0000-\u0020\u007f\\]/.test(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) {
    return true;
  }

  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === "https:" || url.protocol === "http:");
  } catch {
    return false;
  }
}

export function safeEvidenceSourceUri(value: string) {
  return isSafeEvidenceSourceUri(value) ? value : "#";
}
