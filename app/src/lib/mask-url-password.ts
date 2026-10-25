const MASK = "•••";

/**
 * Masks the password in a URL's userinfo for display only
 * (`https://user:secret@host/p?x=1` -> `https://user:•••@host/p?x=1`).
 *
 * String-based on purpose: the rest of the value is returned byte-for-byte,
 * so targets that are not URLs, or have no userinfo password, are unchanged.
 * The stored value is never modified; use this only when rendering.
 */
export function maskUrlPassword(value: string): string;
export function maskUrlPassword(value: string | null | undefined): string | null | undefined;
export function maskUrlPassword(value: string | null | undefined) {
  if (!value) return value;
  const schemeMatch = /^(\s*[a-z][a-z0-9+.-]*:\/\/)/i.exec(value);
  if (!schemeMatch) return value;

  const authorityStart = schemeMatch[0].length;
  const authorityEndOffset = value.slice(authorityStart).search(/[/?#]/);
  const authorityEnd =
    authorityEndOffset === -1 ? value.length : authorityStart + authorityEndOffset;
  const authority = value.slice(authorityStart, authorityEnd);

  // The last "@" separates userinfo from host (userinfo may contain raw "@").
  const at = authority.lastIndexOf("@");
  if (at === -1) return value;
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(":");
  if (colon === -1 || colon === userinfo.length - 1) return value;

  const masked = `${userinfo.slice(0, colon)}:${MASK}`;
  return (
    value.slice(0, authorityStart) +
    masked +
    authority.slice(at) +
    value.slice(authorityEnd)
  );
}
