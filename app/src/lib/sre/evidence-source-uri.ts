export function isSafeEvidenceSourceUri(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) {
    return true;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function safeEvidenceSourceUri(value: string) {
  return isSafeEvidenceSourceUri(value) ? value : "#";
}
