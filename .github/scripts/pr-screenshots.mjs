#!/usr/bin/env node
// Turns the PR screenshot artifact into a gallery and a PR comment.
//
// The artifact was produced by pull request code, so it is untrusted: only regular
// files with kebab-case .png names, PNG magic bytes and a bounded size get through,
// and nothing from it is ever executed or interpolated into HTML unescaped.
//
//   pr-screenshots.mjs prepare ARTIFACT_DIR OUT_DIR
//       copies valid PNGs to OUT_DIR/images/, writes OUT_DIR/index.html and OUT_DIR/shots.json
//   pr-screenshots.mjs comment OUT_DIR
//       prints the PR comment; reads SHA, RUN_URL, RESULT and optional GALLERY_BASE_URL from env

import { copyFile, lstat, mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = '<!-- supercheck-pr-screenshots -->';
// Real frames are ~150 KB; tight caps limit what a hostile PR can host on the gallery.
export const MAX_SHOTS = 40;
export const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 2_000;
const MAX_DEPTH = 6;
const THUMBNAILS = 6;
const NAME = /^[a-z0-9][a-z0-9-]{0,99}\.png$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// A tiny compressed PNG can declare a huge canvas; bound it so the gallery can't hang a browser.
// Tour frames are 1440 wide and split below 9,000 tall.
export const MAX_WIDTH = 4_000;
export const MAX_HEIGHT = 10_000;

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function caption(file) {
  return file.replace(/\.png$/, '').replace(/-/g, ' ');
}

/** True for a PNG whose IHDR declares dimensions within the gallery limits. */
async function isAcceptablePng(file) {
  const handle = await open(file, 'r');
  try {
    // Signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4).
    const buffer = Buffer.alloc(24);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead < 24 || !buffer.subarray(0, 8).equals(PNG_MAGIC)) return false;
    if (buffer.toString('latin1', 12, 16) !== 'IHDR') return false;
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width > 0 && height > 0 && width <= MAX_WIDTH && height <= MAX_HEIGHT;
  } finally {
    await handle.close();
  }
}

/** Valid screenshots under dir, sorted by name, as [{ name, source }]. */
export async function collectScreenshots(dir) {
  const found = new Map();
  let entries = 0;
  async function walk(current, depth) {
    if (depth > MAX_DEPTH) return;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (++entries > MAX_ENTRIES) throw new Error(`Artifact has more than ${MAX_ENTRIES} entries`);
      const full = path.join(current, entry.name);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        await walk(full, depth + 1);
      } else if (
        stat.isFile() &&
        NAME.test(entry.name) &&
        stat.size > 0 &&
        stat.size <= MAX_BYTES &&
        !found.has(entry.name) &&
        (await isAcceptablePng(full))
      ) {
        found.set(entry.name, full);
      } else if (stat.isFile()) {
        console.warn(`Skipped ${JSON.stringify(entry.name)}: not a unique kebab-case PNG within ${MAX_BYTES} bytes and ${MAX_WIDTH}x${MAX_HEIGHT}px`);
      }
    }
  }
  await walk(dir, 0);
  if (found.size > MAX_SHOTS) console.warn(`Keeping the first ${MAX_SHOTS} of ${found.size} screenshots`);
  return [...found.keys()]
    .sort()
    .slice(0, MAX_SHOTS)
    .map((name) => ({ name, source: found.get(name) }));
}

export function renderGallery(names, { sha, runUrl }) {
  const cards = names
    .map((name) => {
      const src = `images/${encodeURIComponent(name)}`;
      return `<figure><a href="${src}"><img src="${src}" alt="${escapeHtml(caption(name))}" loading="lazy"></a><figcaption>${escapeHtml(caption(name))}</figcaption></figure>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>PR screenshots</title>
<style>
:root{color-scheme:light dark;--bg:#fafafa;--fg:#111;--card:#fff;--line:#ddd}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#eee;--card:#1b1b1b;--line:#333}}
body{margin:0;padding:16px;font:14px system-ui,sans-serif;background:var(--bg);color:var(--fg)}
main{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}
img{display:block;width:100%;height:auto}figcaption{padding:8px 12px}
code{font-size:13px}
</style></head><body>
<h1>PR screenshots</h1>
<p>Commit <code>${escapeHtml(sha.slice(0, 7))}</code> · <a href="${escapeHtml(runUrl)}">CI run</a> · ${names.length} frames. Seeded demo data only.</p>
<main>
${cards}
</main></body></html>
`;
}

export function renderComment(names, { sha, runUrl, result, galleryBaseUrl }) {
  const lines = [MARKER, '### Playwright screenshots', ''];
  if (result !== 'success') {
    lines.push('⚠️ The screenshot run did not pass; frames may be missing. See the CI run.', '');
  }
  if (names.length === 0) {
    lines.push('No screenshots were captured.');
  } else if (galleryBaseUrl) {
    const base = galleryBaseUrl.replace(/\/$/, '');
    const cells = names.slice(0, THUMBNAILS).map((name) => {
      const src = `${base}/images/${encodeURIComponent(name)}`;
      return `<a href="${src}"><img src="${src}" width="280" alt="${escapeHtml(caption(name))}"></a>`;
    });
    lines.push(cells.join(' '), '', `[Open all ${names.length} screenshots](${base}/index.html) · [CI run](${runUrl})`);
  } else {
    lines.push(`${names.length} screenshots are attached to the [CI run](${runUrl}) as the \`pr-screenshots\` artifact.`);
  }
  lines.push('', `Updated for commit \`${sha.slice(0, 7)}\`.`);
  return lines.join('\n');
}

function requireHttps(name, value, optional = false) {
  if (!value && optional) return '';
  if (!value || !URL.canParse(value) || new URL(value).protocol !== 'https:') {
    throw new Error(`${name} must be an https URL`);
  }
  return value;
}

async function main([command, ...args]) {
  if (command === 'prepare' && args.length === 2) {
    const [artifactDir, outDir] = args;
    const shots = await collectScreenshots(artifactDir);
    await mkdir(path.join(outDir, 'images'), { recursive: true });
    for (const { name, source } of shots) await copyFile(source, path.join(outDir, 'images', name));
    const names = shots.map((s) => s.name);
    const sha = process.env.SHA ?? '';
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('SHA must be a full commit SHA');
    const runUrl = requireHttps('RUN_URL', process.env.RUN_URL);
    await writeFile(path.join(outDir, 'index.html'), renderGallery(names, { sha, runUrl }));
    await writeFile(path.join(outDir, 'shots.json'), JSON.stringify(names));
    console.log(`Prepared ${names.length} screenshots.`);
    return;
  }
  if (command === 'comment' && args.length === 1) {
    const names = JSON.parse(await readFile(path.join(args[0], 'shots.json'), 'utf8'));
    const sha = process.env.SHA ?? '';
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('SHA must be a full commit SHA');
    process.stdout.write(
      `${renderComment(names, {
        sha,
        runUrl: requireHttps('RUN_URL', process.env.RUN_URL),
        result: process.env.RESULT ?? 'failure',
        galleryBaseUrl: requireHttps('GALLERY_BASE_URL', process.env.GALLERY_BASE_URL, true),
      })}\n`,
    );
    return;
  }
  throw new Error('Usage: pr-screenshots.mjs prepare ARTIFACT_DIR OUT_DIR | comment OUT_DIR');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
