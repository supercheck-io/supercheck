/**
 * Post-authentication continuation targets are restricted to an explicit
 * allowlist of local paths, so a crafted `?next=` can never become an open
 * redirect. Today only the device-approval page may be resumed.
 */
const DEVICE_PATH = /^\/device(?:\?code=[A-Za-z0-9-]{1,16})?$/;

export function sanitizeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 64) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  // Reject anything that is not a plain, single-slash local path.
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) {
    return null;
  }
  return DEVICE_PATH.test(value) ? value : null;
}

export function buildDeviceReturnPath(code: string | null | undefined): string {
  return code && /^[A-Za-z0-9-]{1,16}$/.test(code)
    ? `/device?code=${code}`
    : "/device";
}
