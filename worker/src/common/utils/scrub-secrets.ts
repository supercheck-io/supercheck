/**
 * Replace every occurrence of a resolved secret in any string inside `value` (deep, arrays and
 * objects). A monitored endpoint can echo a credential back in any field it returns, so stored
 * monitor results are scrubbed as a whole rather than field by field.
 */
// Stored text is often truncated before scrubbing, so a secret cut at the end leaves a prefix behind.
const MIN_TAIL = 4;
const MIN_SECRET_LENGTH = 4;
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
  // Shorter values would mask ordinary text everywhere; such secrets carry no real protection anyway.
  const live = secrets.filter((s) => s.length >= MIN_SECRET_LENGTH);
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

/**
 * The forms an endpoint can echo a secret back in: as sent, URL-encoded, JSON-escaped and, for
 * basic auth, the base64 `user:secret` credential.
 */
export function secretEchoForms(secret: string, basicUser?: string): string[] {
  const forms = [
    secret,
    encodeURIComponent(secret),
    JSON.stringify(secret).slice(1, -1),
  ];
  if (basicUser !== undefined)
    forms.push(Buffer.from(`${basicUser}:${secret}`).toString('base64'));
  return [...new Set(forms)];
}
