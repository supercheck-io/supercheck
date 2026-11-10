#!/usr/bin/env node
// Turns the PR screenshot artifact into a gallery and a PR comment.
//
// The artifact was produced by pull request code, so it is untrusted: only regular
// files with kebab-case .png names, PNG magic bytes and a bounded size get through,
// and nothing from it is ever executed or interpolated into HTML unescaped.
//
//   pr-screenshots.mjs prepare ARTIFACT_DIR OUT_DIR [BASELINE_MANIFEST]
//       copies valid PNGs to OUT_DIR/images/ and writes OUT_DIR/index.html, OUT_DIR/shots.json
//       and OUT_DIR/manifest.json (the checkpoint hashes a main run publishes as the baseline).
//       Env: SHA, RUN_URL, RESULT, optional PR_NUMBER, PR_URL, GALLERY_BASE_URL, PUBLIC_URL.
//   pr-screenshots.mjs comment OUT_DIR
//       prints the PR comment; reads RUN_URL and optional GALLERY_BASE_URL from env
//
// The baseline manifest comes from the same bucket PR galleries are written to, so it is
// validated like the artifact: names, hashes and URLs are checked and anything else is dropped.

import { createHash } from 'node:crypto';
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

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const FAILURE_PREFIX = 'failed-';
// Frames that need a reviewer's eye come first, in this order.
const ORDER = { failed: 0, changed: 1, new: 2, unchanged: 3, unknown: 4 };

export function title(name) {
  return caption(name.startsWith(FAILURE_PREFIX) ? name.slice(FAILURE_PREFIX.length) : name).replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

function isHttps(value) {
  return typeof value === 'string' && URL.canParse(value) && new URL(value).protocol === 'https:';
}

/**
 * Parses an untrusted baseline manifest. Returns null when it is unusable, so the
 * gallery simply shows no comparison labels.
 */
export function parseBaseline(text, { publicUrl = '' } = {}) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.shots)) return null;
  if (!COMMIT.test(data.sha ?? '') || data.shots.length > MAX_SHOTS) return null;
  const shots = new Map();
  for (const shot of data.shots) {
    if (!shot || !NAME.test(shot.name ?? '') || !SHA256.test(shot.sha256 ?? '')) return null;
    shots.set(shot.name, shot.sha256);
  }
  const base = publicUrl.replace(/\/$/, '');
  // Only link main's images when they live under our own public bucket URL.
  // Compare the normalised URL so `..` segments cannot climb out of the bucket prefix.
  const images = isHttps(data.imagesUrl) ? new URL(data.imagesUrl).href : '';
  const imagesUrl = base && images.startsWith(`${base}/`) ? images.replace(/\/$/, '') : '';
  const runUrl = isHttps(data.runUrl) && data.runUrl.startsWith('https://github.com/') ? data.runUrl : '';
  return { sha: data.sha, imagesUrl, runUrl, shots };
}

/** Labels each frame against the baseline: checkpoint or failure, and new / changed / unchanged. */
export function classify(hashed, baseline) {
  const shots = hashed.map(({ name, sha256: hash }) => {
    const kind = name.startsWith(FAILURE_PREFIX) ? 'failure' : 'checkpoint';
    let status = 'unknown';
    if (kind === 'failure') status = 'failed';
    else if (baseline) status = !baseline.shots.has(name) ? 'new' : baseline.shots.get(name) === hash ? 'unchanged' : 'changed';
    return { name, kind, sha256: hash, status };
  });
  shots.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));
  const present = new Set(hashed.map((s) => s.name));
  const removed = baseline ? [...baseline.shots.keys()].filter((name) => !present.has(name)).sort() : [];
  return { shots, removed };
}

export function counts(shots) {
  const c = { all: shots.length, review: 0, new: 0, changed: 0, failed: 0 };
  for (const { status } of shots) {
    if (status in c) c[status] += 1;
    if (status === 'new' || status === 'changed' || status === 'failed') c.review += 1;
  }
  return c;
}

const TAG = {
  checkpoint: 'Checkpoint',
  failure: 'Failure',
  new: 'New',
  changed: 'Changed',
  unchanged: 'Unchanged',
  failed: 'Failed',
};

// Static, so the CSP can pin it by hash. It never reads frame data into HTML.
const SCRIPT = `(() => {
  const grid = document.getElementById('grid');
  const cards = [...grid.children];
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const REVIEW = new Set(['new', 'changed', 'failed']);
  function filter(value) {
    for (const b of document.querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed', String(b.dataset.filter === value));
    for (const card of cards) {
      const s = card.dataset.status;
      card.hidden = !(value === 'all' || s === value || (value === 'review' && REVIEW.has(s)));
    }
    document.getElementById('empty').hidden = cards.some((c) => !c.hidden);
  }
  function density(value) {
    for (const b of document.querySelectorAll('[data-cols]')) b.setAttribute('aria-pressed', String(b.dataset.cols === value));
    grid.style.setProperty('--cols', value);
    store.set('visual-review-cols', value);
  }
  for (const b of document.querySelectorAll('[data-filter]')) b.addEventListener('click', () => filter(b.dataset.filter));
  for (const b of document.querySelectorAll('[data-cols]')) b.addEventListener('click', () => density(b.dataset.cols));
  const saved = store.get('visual-review-cols');
  density(['1', '2', '3', '4'].includes(saved) ? saved : '3');
  filter('all');
})();`;
const SCRIPT_HASH = createHash('sha256').update(SCRIPT).digest('base64');

const STYLE = `
:root{color-scheme:dark;--bg:#0a0a0f;--fg:#f4f4f6;--muted:#a1a1aa;--line:#2a2a33;--card:#131318;--well:#1b1b22;--accent:#6d4aff;--accent-fg:#d9d0ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg) radial-gradient(1200px 480px at 50% -120px,#2b1f6b 0%,transparent 70%) no-repeat;color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1760px;margin:0 auto;padding:56px 16px 64px}
@media (min-width:720px){.wrap{padding:72px 48px 80px}}
.eyebrow{margin:0 0 12px;color:#b9a8ff;font-size:13px;font-weight:700;letter-spacing:.22em;text-transform:uppercase}
.top{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-end;justify-content:space-between}
h1{margin:0;font-size:clamp(36px,6vw,76px);line-height:1;letter-spacing:-.04em;font-weight:800}
.lede{margin:16px 0 0;color:var(--muted);font-size:17px}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.pill,button{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:6px 16px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.03);color:var(--fg);font:inherit;text-decoration:none}
a.pill:hover,button:hover{border-color:#4b4b57}
a:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.pill.ok{color:#8ee6a8}.pill.bad{color:#ff9b9b}
.meta{margin-top:40px;justify-content:space-between}
.filters{margin:20px 0 28px}
.filters button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}
.density{gap:4px;padding:4px;border:1px solid var(--line);border-radius:12px}
.density button{min-height:36px;padding:0 10px;border:0;border-radius:8px;background:none}
.density button[aria-pressed=true]{background:var(--accent)}
.density svg{display:block;width:20px;height:16px;fill:currentColor}
main{display:grid;gap:24px;grid-template-columns:repeat(var(--cols,3),minmax(0,1fr))}
@media (max-width:719px){main{grid-template-columns:1fr!important}.density{display:none}}
article{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:18px;background:var(--card);overflow:hidden}
article[hidden]{display:none}
.shot{display:flex;align-items:center;justify-content:center;aspect-ratio:16/12;padding:16px;background:var(--well);border-bottom:1px solid var(--line)}
.shot img{display:block;max-width:100%;max-height:100%;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.45);object-fit:contain;object-position:top}
.body{display:flex;gap:16px;align-items:center;padding:20px}
.num{flex:none;display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:#2a1f66;color:var(--accent-fg);font-weight:700}
.info{min-width:0}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
.tag{padding:2px 8px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
.t-checkpoint{background:#3a2a8f;color:#d9d0ff}.t-failure,.t-failed{background:#5c1d24;color:#ffb3b3}
.t-changed{background:#5a3d0f;color:#f5c46b}.t-new{background:#123f2b;color:#8ee6a8}.t-unchanged{background:#26262e;color:var(--muted)}
h2{margin:0 0 4px;font-size:19px;line-height:1.25}
.mono{margin:0;color:var(--muted);font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mono a{color:#b9a8ff}
#empty{padding:48px;color:var(--muted);text-align:center}
`;

const ICONS = ['M2 2h16v12H2z', 'M2 2h7v12H2zM11 2h7v12h-7z', 'M1 2h5v12H1zM7.5 2h5v12h-5zM14 2h5v12h-5z', 'M1 2h3.5v12H1zM5.8 2h3.5v12H5.8zM10.7 2h3.5v12h-3.5zM15.5 2H19v12h-3.5z'];

/** The visual review page. `gallery` comes from prepare(); every value is escaped. */
export function renderGallery(gallery) {
  const { shots, removed = [], sha, runUrl, result, prNumber = '', prUrl = '', baseline = null, generatedAt } = gallery;
  const c = counts(shots);
  const heading = prNumber ? `PR #${prNumber} screenshots` : 'main screenshots';
  const cards = shots
    .map((shot, i) => {
      const src = `images/${encodeURIComponent(shot.name)}`;
      const label = escapeHtml(title(shot.name));
      const tags = [shot.kind, shot.status === 'failed' || shot.status === 'unknown' ? '' : shot.status]
        .filter(Boolean)
        .map((t) => `<span class="tag t-${t}">${TAG[t]}</span>`)
        .join('');
      const what = shot.kind === 'failure' ? 'Captured when the test failed' : 'Intentional test checkpoint';
      const main =
        shot.status === 'changed' && baseline?.imagesUrl
          ? `<p class="mono"><a href="${escapeHtml(`${baseline.imagesUrl}/${encodeURIComponent(shot.name)}`)}">Open main version</a></p>`
          : '';
      return `<article data-status="${shot.status}"><a class="shot" href="${src}"><img src="${src}" alt="${label}" loading="lazy"></a>
<div class="body"><span class="num">${String(i + 1).padStart(2, '0')}</span><div class="info"><div class="tags">${tags}</div><h2>${label}</h2>
<p class="mono" title="${escapeHtml(shot.name)}">${what} · ${escapeHtml(shot.name)}</p><p class="mono">SHA-256 ${shot.sha256.slice(0, 12)}</p>${main}</div></div></article>`;
    })
    .join('\n');
  const compared = !prNumber
    ? 'Main branch run'
    : baseline
      ? `Compared with latest successful main run (${escapeHtml(baseline.sha.slice(0, 7))})`
      : 'No main baseline yet';
  const links = [
    prUrl ? `<a class="pill" href="${escapeHtml(prUrl)}">PR #${escapeHtml(prNumber)}</a>` : '',
    `<a class="pill" href="${escapeHtml(runUrl)}">GitHub Actions</a>`,
    baseline?.runUrl ? `<a class="pill" href="${escapeHtml(baseline.runUrl)}">Main run</a>` : '',
  ].join('');
  const filter = (key, text) => `<button type="button" data-filter="${key}" aria-pressed="false">${text} (${c[key]})</button>`;
  const csp = `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'sha256-${SCRIPT_HASH}'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="robots" content="noindex"><title>${escapeHtml(heading)}</title>
<style>${STYLE}</style></head><body><div class="wrap">
<p class="eyebrow">Supercheck · Visual review</p>
<div class="top"><div><h1>${escapeHtml(heading)}</h1><p class="lede">Review intentional checkpoints separately from automatic failure captures. Seeded demo data only.</p></div>
<nav class="row" aria-label="Links">${links}</nav></div>
<div class="row meta"><div class="row">
<span class="pill ${result === 'success' ? 'ok' : 'bad'}">${escapeHtml(result)}</span>
<span class="pill">${escapeHtml(sha.slice(0, 7))}</span>
<span class="pill">${shots.length} screenshots</span>
<span class="pill">${compared}</span>
${removed.length ? `<span class="pill" title="${escapeHtml(removed.join(', '))}">${removed.length} removed since main</span>` : ''}
<span class="pill">${escapeHtml(new Date(generatedAt).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium' }))} UTC</span>
</div>
<div class="row density" role="group" aria-label="Columns">${ICONS.map((d, i) => `<button type="button" data-cols="${i + 1}" aria-pressed="false" aria-label="${i + 1} column${i ? 's' : ''}"><svg viewBox="0 0 20 16" aria-hidden="true"><path d="${d}"/></svg></button>`).join('')}</div></div>
<div class="row filters" role="group" aria-label="Filter">${filter('all', 'All')}${filter('review', 'Review changes')}${filter('new', 'New')}${filter('changed', 'Changed')}${filter('failed', 'Failed')}</div>
<main id="grid">
${cards}
</main><p id="empty" hidden>No screenshots match this filter.</p>
</div><script>${SCRIPT}</script></body></html>
`;
}

export function renderComment(gallery, { runUrl, galleryBaseUrl }) {
  const { shots, removed = [], result, baseline = null, sha } = gallery;
  const c = counts(shots);
  const lines = [MARKER, '### Playwright screenshots', ''];
  if (result !== 'success') {
    lines.push('⚠️ The screenshot run did not pass; frames may be missing. See the CI run.', '');
  }
  if (shots.length === 0) {
    lines.push('No screenshots were captured.');
  } else {
    const summary = baseline
      ? `**${c.changed} changed · ${c.new} new · ${c.failed} failed**${removed.length ? ` · ${removed.length} removed` : ''} vs main \`${baseline.sha.slice(0, 7)}\``
      : `**${c.all} screenshots** · ${c.failed} failed · no main baseline to compare yet`;
    lines.push(summary, '');
    if (galleryBaseUrl) {
      const base = galleryBaseUrl.replace(/\/$/, '');
      // Review-worthy frames sort first; with no changes there is nothing to preview.
      const preview = shots.filter((s) => s.status !== 'unchanged').slice(0, THUMBNAILS);
      const cells = preview.map(({ name }) => {
        const src = `${base}/images/${encodeURIComponent(name)}`;
        return `<a href="${escapeHtml(src)}"><img src="${escapeHtml(src)}" width="280" alt="${escapeHtml(caption(name))}"></a>`;
      });
      if (cells.length) lines.push(cells.join(' '), '');
      lines.push(`[Open visual review (${c.all} screenshots)](${base}/index.html) · [CI run](${runUrl})`);
    } else {
      lines.push(`The screenshots are attached to the [CI run](${runUrl}) as the \`pr-screenshots\` artifact.`);
    }
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
  if (command === 'prepare' && (args.length === 2 || args.length === 3)) {
    const [artifactDir, outDir, baselinePath] = args;
    const sha = process.env.SHA ?? '';
    if (!COMMIT.test(sha)) throw new Error('SHA must be a full commit SHA');
    const runUrl = requireHttps('RUN_URL', process.env.RUN_URL);
    const prNumber = process.env.PR_NUMBER ?? '';
    if (prNumber && !/^[1-9][0-9]*$/.test(prNumber)) throw new Error('PR_NUMBER must be a positive integer');
    const prUrl = requireHttps('PR_URL', process.env.PR_URL, true);
    const galleryBaseUrl = requireHttps('GALLERY_BASE_URL', process.env.GALLERY_BASE_URL, true).replace(/\/$/, '');
    const publicUrl = requireHttps('PUBLIC_URL', process.env.PUBLIC_URL, true);

    let baseline = null;
    if (baselinePath) {
      const text = await readFile(baselinePath, 'utf8').catch(() => null);
      baseline = text === null ? null : parseBaseline(text, { publicUrl });
      if (text !== null && !baseline) console.warn('Ignoring an invalid baseline manifest');
    }

    const found = await collectScreenshots(artifactDir);
    await mkdir(path.join(outDir, 'images'), { recursive: true });
    const hashed = [];
    for (const { name, source } of found) {
      const target = path.join(outDir, 'images', name);
      await copyFile(source, target);
      hashed.push({ name, sha256: await sha256(target) });
    }
    const result = process.env.RESULT ?? 'failure';
    const { shots, removed: missing } = classify(hashed, baseline);
    // A failed run may simply not have reached some pages; don't report those as removed.
    const removed = result === 'success' ? missing : [];
    const gallery = {
      shots,
      removed,
      sha,
      runUrl,
      result,
      prNumber,
      prUrl,
      baseline: baseline && { sha: baseline.sha, imagesUrl: baseline.imagesUrl, runUrl: baseline.runUrl },
      generatedAt: new Date().toISOString(),
    };
    await writeFile(path.join(outDir, 'index.html'), renderGallery(gallery));
    await writeFile(path.join(outDir, 'shots.json'), JSON.stringify(gallery));
    const manifest = {
      version: 1,
      sha,
      runUrl,
      imagesUrl: galleryBaseUrl ? `${galleryBaseUrl}/images` : '',
      shots: shots.filter((s) => s.kind === 'checkpoint').map(({ name, sha256: hash }) => ({ name, sha256: hash })),
    };
    await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest));
    console.log(`Prepared ${shots.length} screenshots${baseline ? ` against main ${baseline.sha.slice(0, 7)}` : ''}.`);
    return;
  }
  if (command === 'comment' && args.length === 1) {
    const gallery = JSON.parse(await readFile(path.join(args[0], 'shots.json'), 'utf8'));
    process.stdout.write(
      `${renderComment(gallery, {
        runUrl: requireHttps('RUN_URL', process.env.RUN_URL),
        galleryBaseUrl: requireHttps('GALLERY_BASE_URL', process.env.GALLERY_BASE_URL, true),
      })}\n`,
    );
    return;
  }
  throw new Error('Usage: pr-screenshots.mjs prepare ARTIFACT_DIR OUT_DIR [BASELINE_MANIFEST] | comment OUT_DIR');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
