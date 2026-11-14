/**
 * Replace every occurrence of a resolved secret in any string inside `value` (deep, arrays and
 * objects). A monitored endpoint can echo a credential back in any field it returns, so stored
 * monitor results are scrubbed as a whole rather than field by field.
 */
export function scrubSecrets<T>(value: T, secrets: readonly string[]): T {
  const live = secrets.filter((s) => s.length > 0);
  if (live.length === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string')
      return live.reduce((text, s) => text.split(s).join('***'), v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Date))
      return Object.fromEntries(
        Object.entries(v).map(([k, item]) => [k, walk(item)]),
      );
    return v;
  };
  return walk(value) as T;
}
