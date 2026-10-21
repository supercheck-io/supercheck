/**
 * Webhook payloads arrive snake_case from newer provider API versions and
 * camelCase from older ones. Handlers read camelCase (and some snake_case), so
 * normalise once at the plugin boundary: every snake_case key gains a camelCase
 * alias, the original key is kept, and an existing camelCase key is never
 * overwritten. Merchant-supplied metadata is passed through untouched.
 */
const OPAQUE_KEYS = new Set(["metadata", "customer_metadata"]);
// Deeper than any real payload; beyond this, subtrees are returned as-is so a
// hostile body cannot overflow the stack.
const MAX_DEPTH = 32;

function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalize(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value))
    return value.map((item) => normalize(item, depth + 1));
  if (!isPlainObject(value)) return value;

  // Ordinary object, own-property writes only: a "__proto__" key from JSON.parse
  // stays data, while handlers keep working with normal Object.prototype methods.
  const result: Record<string, unknown> = {};
  const set = (key: string, child: unknown) =>
    Object.defineProperty(result, key, {
      value: child,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  for (const [key, child] of Object.entries(value)) {
    set(key, OPAQUE_KEYS.has(key) ? child : normalize(child, depth + 1));
  }
  for (const key of Object.keys(value)) {
    const camel = toCamel(key);
    // Never alias onto a name Object.prototype already provides (toString, ...).
    if (
      camel !== key &&
      !(camel in Object.prototype) &&
      !Object.hasOwn(result, camel)
    ) {
      set(camel, result[key]);
    }
  }
  return result;
}

export function normalizePolarPayload<T>(value: T): T {
  return normalize(value, 0) as T;
}
