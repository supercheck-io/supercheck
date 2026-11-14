/**
 * Replace every occurrence of a resolved secret in any string inside `value` (deep, arrays and
 * objects). A monitored endpoint can echo a credential back in any field it returns, so stored
 * monitor results are scrubbed as a whole rather than field by field.
 */
// Stored text is often truncated before scrubbing, so a secret cut at the end leaves a prefix behind.
const MIN_TAIL = 4;
export const MIN_SECRET_LENGTH = 4;
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
  // Longest first, so a form that contains another (base64 of user:secret) is replaced whole.
  const live = secrets
    .filter((s) => s.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
  if (live.length === 0) return value;
  // Every whole form first, then tail masking: a tail mask must never cut a later form's match short.
  const scrubText = (text: string) =>
    live.reduce(
      (t, s) => maskTail(t, s),
      live.reduce((t, s) => t.split(s).join('***'), text),
    );
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return scrubText(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Date))
      return Object.fromEntries(
        // Keys too: an endpoint can echo a credential as a header or JSON property name.
        Object.entries(v).map(([k, item]) => [scrubText(k), walk(item)]),
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
  const url = encodeURIComponent(secret);
  const json = JSON.stringify(secret).slice(1, -1);
  const html = secret
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  // shortcut: common echo encodings only (not \uXXXX escapes); a key of letters, digits and -_ is covered fully.
  const forms = [
    secret,
    url,
    url.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()),
    url.replace(/%20/g, '+'),
    json,
    json.replace(/\//g, '\\/'),
    html,
    Buffer.from(secret).toString('base64'),
  ];
  if (basicUser !== undefined)
    forms.push(Buffer.from(`${basicUser}:${secret}`).toString('base64'));
  return [...new Set(forms)];
}
