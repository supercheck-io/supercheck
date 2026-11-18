import * as fs from 'fs/promises';
import * as path from 'path';
import { crc32, deflateRawSync, inflateRawSync } from 'zlib';

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
const TEXT_REPORT_EXT = new Set(['.html', '.json', '.txt', '.md', '.xml']);

// Larger text files are skipped (with a warning) instead of read whole into memory.
const MAX_SCRUB_FILE_BYTES = 20 * 1024 * 1024;

/** Raw, base64, URL-encoded, JSON-escaped and HTML-entity-escaped forms of each secret long enough to redact. */
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
    out.add(
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    );
  }
  return [...out]
    .filter((v) => v.length >= MIN_REPORT_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
}

// Playwright's HTML reporter keeps the whole report (test errors, steps) as a deflated zip inside this
// <template> in index.html, where a plain text replace can never match a secret.
const EMBEDDED_REPORT =
  /(<template id="playwrightReportBase64">data:application\/zip;base64,)([A-Za-z0-9+/=]+)(<\/template>)/;
// Total inflated bytes for the whole zip: entries may share local data, so a per-entry cap is not enough.
const MAX_ZIP_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1000;

interface ZipEntry {
  name: Buffer;
  data: Buffer;
  time: number;
  date: number;
}

export function readZip(zip: Buffer): ZipEntry[] {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Report zip has no end record');
  let p = zip.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  const count = zip.readUInt16LE(eocd + 10);
  if (count > MAX_ZIP_ENTRIES) throw new Error('Report zip has too many files');
  let budget = MAX_ZIP_TOTAL_BYTES;
  for (let n = count; n > 0; n--) {
    if (zip.readUInt32LE(p) !== 0x02014b50)
      throw new Error('Report zip is corrupt');
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const local = zip.readUInt32LE(p + 42);
    const nameLength = zip.readUInt16LE(p + 28);
    if (size === 0xffffffff || local === 0xffffffff)
      throw new Error('Report zip64 is not supported');
    const start =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    if (zip.readUInt32LE(local) !== 0x04034b50)
      throw new Error('Report zip is corrupt');
    const raw = zip.subarray(start, start + size);
    if (method !== 0 && method !== 8)
      throw new Error('Report zip uses an unsupported compression');
    const data =
      method === 0
        ? raw
        : inflateRawSync(raw, { maxOutputLength: Math.max(budget, 1) });
    budget -= data.length;
    if (budget < 0) throw new Error('Report zip is too large');
    entries.push({
      name: zip.subarray(p + 46, p + 46 + nameLength),
      data,
      time: zip.readUInt16LE(p + 12),
      date: zip.readUInt16LE(p + 14),
    });
    p += 46 + nameLength + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return entries;
}

function writeZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data, time, date } of entries) {
    const packed = deflateRawSync(data);
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0); // version needed
    common.writeUInt16LE(0x0800, 2); // UTF-8 names
    common.writeUInt16LE(8, 4); // deflate
    common.writeUInt16LE(time, 6);
    common.writeUInt16LE(date, 8);
    common.writeUInt32LE(crc32(data), 10);
    common.writeUInt32LE(packed.length, 14);
    common.writeUInt32LE(data.length, 18);
    common.writeUInt16LE(name.length, 22);
    const local = Buffer.concat([
      Buffer.from('504b0304', 'hex'),
      common,
      name,
      packed,
    ]);
    const dir = Buffer.alloc(14); // clen, disk, attributes, local offset follow the shared fields
    dir.writeUInt32LE(offset, 10);
    parts.push(local);
    central.push(
      Buffer.concat([
        Buffer.from('504b01021400', 'hex'), // signature, version made by
        common, // through the extra-field length
        dir,
        name,
      ]),
    );
    offset += local.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

const MARKER = '<template id="playwrightReportBase64">';

/**
 * Scrubs index.html: the zip Playwright embeds is rewritten entry by entry, and the rest of the page gets the plain
 * text replace (never the base64 blob, where a short secret could match by chance and corrupt the zip).
 * An index.html without the marker (a k6 dashboard) only gets the plain replace.
 */
export function scrubReportHtml(html: string, variants: string[]): string {
  const plain = (text: string) =>
    variants.reduce((out, v) => out.split(v).join('[SECRET]'), text);
  const match = EMBEDDED_REPORT.exec(html);
  if (!match) {
    // Fail closed if Playwright changes this markup: an unmatched report would be uploaded unscrubbed.
    if (html.includes('playwrightReportBase64'))
      throw new Error('Report zip markup is not recognised');
    return plain(html);
  }
  const [all, head, b64, tail] = match;
  const entries = readZip(Buffer.from(b64, 'base64'));
  for (const entry of entries) {
    const original = entry.data.toString('utf8');
    const text = plain(original);
    if (text !== original) entry.data = Buffer.from(text, 'utf8');
  }
  return (
    plain(html.slice(0, match.index) + head) +
    writeZip(entries).toString('base64') +
    plain(tail + html.slice(match.index + all.length))
  );
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
        if ((await fs.stat(full)).size > MAX_SCRUB_FILE_BYTES) {
          // A Playwright report is embedded in index.html: uploading it unscrubbed would publish any secret in it.
          if (
            entry.name === 'index.html' &&
            (await fs.readFile(full)).includes(MARKER)
          )
            throw new Error('Report index.html is too large to scrub');
          console.warn(
            `Skipping secret scrub of oversized report file: ${entry.name}`,
          );
          continue;
        }
        const original = await fs.readFile(full, 'utf8');
        let text = original;
        if (entry.name === 'index.html') text = scrubReportHtml(text, variants);
        else for (const v of variants) text = text.split(v).join('[SECRET]');
        if (text !== original) await fs.writeFile(full, text, 'utf8');
      }
    }
  };
  await walk(dir);
}
