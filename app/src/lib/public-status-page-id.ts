const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPACT_UUID_PATTERN = /^[0-9a-f]{32}$/i;

export function normalizePublicStatusPageId(
  value: string | null | undefined
): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();

  if (CANONICAL_UUID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  if (!COMPACT_UUID_PATTERN.test(trimmed)) {
    return null;
  }

  return [
    trimmed.slice(0, 8),
    trimmed.slice(8, 12),
    trimmed.slice(12, 16),
    trimmed.slice(16, 20),
    trimmed.slice(20),
  ].join("-");
}
