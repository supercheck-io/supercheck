/**
 * Webhook payloads arrive snake_case from newer provider API versions and
 * camelCase from older ones. Handlers read camelCase (and some snake_case), so
 * normalise once at the plugin boundary: every snake_case key gains a camelCase
 * alias, the original key is kept, and an existing camelCase key is never
 * overwritten. Merchant-supplied metadata is passed through untouched.
 */
const OPAQUE_KEYS = new Set(["metadata", "customer_metadata"]);

function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function normalizePolarPayload<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => normalizePolarPayload(item)) as T;
  }
  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = OPAQUE_KEYS.has(key) ? child : normalizePolarPayload(child);
  }
  for (const key of Object.keys(value)) {
    const camel = toCamel(key);
    if (camel !== key && !(camel in result)) result[camel] = result[key];
  }
  return result as T;
}
