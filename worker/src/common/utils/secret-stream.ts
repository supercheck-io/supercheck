import * as fs from 'fs/promises';
import * as path from 'path';

/** Keep only a secret-length tail so matches across transport chunks stay private. */
export function createSecretStream(
  secrets: Record<string, string>,
  emit: (text: string) => Promise<void>,
) {
  const values = [...new Set(Object.values(secrets).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  const tailSize = Math.max(0, ...values.map((value) => value.length - 1));
  let pending = '';
  const redact = (text: string) => {
    for (const value of values) text = text.split(value).join('[SECRET]');
    return text;
  };
  return {
    async write(chunk: string) {
      pending += chunk;
      let end = Math.max(0, pending.length - tailSize);
      let previousEnd: number;
      do {
        previousEnd = end;
        for (const value of values) {
          let start = pending.indexOf(value);
          while (start >= 0 && start < end) {
            if (start + value.length > end) end = start;
            start = pending.indexOf(value, start + 1);
          }
        }
      } while (end !== previousEnd);
      const output = pending.slice(0, end);
      pending = pending.slice(end);
      if (output) await emit(redact(output));
    },
    async flush() {
      const output = pending;
      pending = '';
      if (output) await emit(redact(output));
    },
  };
}

/** Shorter values would mangle unrelated output (e.g. "1", "true"), so they are not redacted in reports. */
export const MIN_REPORT_SECRET_LENGTH = 6;
const TEXT_REPORT_EXT = new Set([
  '.html',
  '.json',
  '.txt',
  '.md',
  '.xml',
  '.js',
  '.css',
]);

/** Raw, base64, URL-encoded and JSON-escaped forms of each secret long enough to redact. */
export function secretRedactionVariants(
  secrets: Record<string, string>,
): string[] {
  const out = new Set<string>();
  for (const value of Object.values(secrets)) {
    if (typeof value !== 'string' || value.length < MIN_REPORT_SECRET_LENGTH)
      continue;
    out.add(value);
    out.add(Buffer.from(value, 'utf8').toString('base64'));
    out.add(encodeURIComponent(value));
    out.add(JSON.stringify(value).slice(1, -1));
  }
  return [...out]
    .filter((v) => v.length >= MIN_REPORT_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
}

/**
 * Rewrites text-like report files in place with secret values replaced.
 * Binary artifacts (trace.zip, screenshots, videos) are not scrubbed.
 */
export async function scrubSecretsFromReportDir(
  dir: string,
  secrets: Record<string, string>,
): Promise<void> {
  const variants = secretRedactionVariants(secrets);
  if (variants.length === 0) return;
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (
        entry.isFile() &&
        TEXT_REPORT_EXT.has(path.extname(entry.name).toLowerCase())
      ) {
        const original = await fs.readFile(full, 'utf8');
        let text = original;
        for (const v of variants) text = text.split(v).join('[SECRET]');
        if (text !== original) await fs.writeFile(full, text, 'utf8');
      }
    }
  };
  await walk(dir);
}
