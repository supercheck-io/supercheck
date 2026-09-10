/**
 * Decode and sanitize Playwright/k6 scripts stored on tests.
 *
 * Scripts are stored as Base64 of UTF-8 source. Older CLI deploys sometimes
 * stored raw TypeScript or compiled JavaScript with an appended binary
 * sourcemap. Monitor execution used to Base64-decode blindly, which corrupted
 * raw TypeScript and left binary sourcemap bytes in compiled output.
 */

export function sanitizeTestScript(script: string): string {
  let text = script.replace(/\u0000/g, '');

  text = text.replace(/^\s*\/\/[#@]\s*sourceMappingURL=.*$/gm, '');
  text = text.replace(/\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g, '');

  const binaryIndex = text.search(
    /[\uFFFD\u0001-\u0008\u000B\u000C\u000E-\u001F]/,
  );
  if (binaryIndex >= 0) {
    text = text.slice(0, binaryIndex);
  }

  return text.replace(/[ \t]+$/gm, '').replace(/\s+$/g, '') + (text.length > 0 ? '\n' : '');
}

export function isGenuineBase64(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(trimmed)) {
    return false;
  }

  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    return Buffer.from(decoded, 'utf8').toString('base64') === trimmed;
  } catch {
    return false;
  }
}

export function decodeStoredTestScript(
  script: string | undefined | null,
): string {
  if (!script) {
    return '';
  }

  const trimmed = script.trim();
  if (isGenuineBase64(trimmed)) {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    return sanitizeTestScript(decoded);
  }

  return sanitizeTestScript(script);
}
