/**
 * Replace every occurrence of a resolved secret in any string inside `value` (deep, arrays and
 * objects). A monitored endpoint can echo a credential back in any field it returns, so stored
 * monitor results are scrubbed as a whole rather than field by field.
 */
// Stored text is often truncated before scrubbing, so a secret cut at the end leaves a prefix behind.
const MIN_TAIL = 4;
function maskTail(text: string, secret: string): string {
  for (
    let n = Math.min(secret.length - 1, text.length);
    n >= MIN_TAIL;
    n -= 1
  ) {
    if (text.endsWith(secret.slice(0, n))) return `${text.slice(0, -n)}***`;
  }
  return text;
}

export function scrubSecrets<T>(value: T, secrets: readonly string[]): T {
  const live = secrets.filter((s) => s.length > 0);
  if (live.length === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string')
      return live.reduce(
        (text, s) => maskTail(text.split(s).join('***'), s),
        v,
      );
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Date))
      return Object.fromEntries(
        Object.entries(v).map(([k, item]) => [k, walk(item)]),
      );
    return v;
  };
  return walk(value) as T;
}
