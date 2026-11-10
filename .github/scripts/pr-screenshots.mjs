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
// The tour plus one E2E checkpoint per test stays well under these.
export const MAX_SHOTS = 400;
export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_META_BYTES = 4 * 1024;
const META_SUFFIX = '.checkpoint.json';
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

/** The PNG's { width, height } when its IHDR declares dimensions within the gallery limits, else null. */
async function pngSize(file) {
  const handle = await open(file, 'r');
  try {
    // Signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4).
    const buffer = Buffer.alloc(24);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead < 24 || !buffer.subarray(0, 8).equals(PNG_MAGIC)) return null;
    if (buffer.toString('latin1', 12, 16) !== 'IHDR') return null;
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width > 0 && height > 0 && width <= MAX_WIDTH && height <= MAX_HEIGHT ? { width, height } : null;
  } finally {
    await handle.close();
  }
}

/**
 * Parses a frame's `<name>.checkpoint.json` sidecar from the E2E checkpoint fixture.
 * It comes from pull request code, so every field is bounded and shape-checked; text is
 * escaped later when rendered. Returns null for anything unusable.
 */
export function parseMeta(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const str = (v, max) => (typeof v === 'string' && v.length <= max ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '');
  const spec = str(data.spec, 200);
  const area = str(data.area, 40);
  return {
    title: str(data.title, 300),
    spec: /^[A-Za-z0-9_./-]+$/.test(spec) && !spec.split('/').includes('..') ? spec : '',
    area: /^[a-z0-9][a-z0-9-]*$/.test(area) ? area : '',
  };
}

/** Valid screenshots under dir, sorted by name, as [{ name, source, width, height, meta }]. */
export async function collectScreenshots(dir) {
  const found = new Map();
  const metas = new Map();
  let total = 0;
  let entries = 0;
  async function walk(current, depth) {
    if (depth > MAX_DEPTH) return;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (++entries > MAX_ENTRIES) throw new Error(`Artifact has more than ${MAX_ENTRIES} entries`);
      const full = path.join(current, entry.name);
      const stat = await lstat(full);
      let size = null;
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        await walk(full, depth + 1);
      } else if (stat.isFile() && entry.name.endsWith(META_SUFFIX)) {
        const name = `${entry.name.slice(0, -META_SUFFIX.length)}.png`;
        if (NAME.test(name) && stat.size <= MAX_META_BYTES && !metas.has(name)) {
          const meta = parseMeta(await readFile(full, 'utf8'));
          if (meta) metas.set(name, meta);
        }
      } else if (
        stat.isFile() &&
        NAME.test(entry.name) &&
        stat.size > 0 &&
        stat.size <= MAX_BYTES &&
        total + stat.size <= MAX_TOTAL_BYTES &&
        !found.has(entry.name) &&
        (size = await pngSize(full))
      ) {
        found.set(entry.name, { full, ...size });
        total += stat.size;
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
    .map((name) => {
      const { full, width, height } = found.get(name);
      return { name, source: full, width, height, meta: metas.get(name) ?? null };
    });
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
  const shots = hashed.map(({ name, sha256: hash, width = 0, height = 0, meta = null }) => {
    const kind = name.startsWith(FAILURE_PREFIX) ? 'failure' : 'checkpoint';
    let status = 'unknown';
    if (kind === 'failure') status = 'failed';
    else if (baseline) status = !baseline.shots.has(name) ? 'new' : baseline.shots.get(name) === hash ? 'unchanged' : 'changed';
    // Tour frames have no sidecar; E2E frames name their spec folder as the area.
    return { name, kind, sha256: hash, status, width, height, title: meta?.title || '', spec: meta?.spec || '', area: meta?.area || (name.startsWith('flow-') ? 'flows' : 'tour') };
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

/**
 * Parses the pull request details the publisher fetched from the GitHub API. The title and
 * branch names are written by the PR author, so they are length-bounded here and escaped on output.
 */
export function parsePullRequest(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const str = (v, max) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : '');
  if (!data || typeof data !== 'object') return null;
  const author = str(data.author, 64);
  return {
    title: str(data.title, 300),
    author: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/.test(author) ? author : '',
    head: str(data.head, 300),
    base: str(data.base, 255),
  };
}

const LOGO = `<svg viewBox="0 0 58 58" aria-hidden="true"><rect x="1.8" y="1.5" width="54.8" height="54.9" rx="15" fill="#fff"/><path fill="#16a34a" d="M56.6 17.74C44.1 26.88 33.33 38.88 23.69 48.95c-.71.71-1.64 1.21-2.64 1.21-1.21 0-2.14-.71-3-2-2.5-3.71-6.28-12.71-8-16.64-1.36-3.21-.64-5.86 2.57-7.21 3.21-1.29 6.78-1.5 7.64 2.14 0 0 1.64 6.36 2.14 8.21 9.93-9.21 22.14-18.99 32.49-24.99-2.57-4.86-7.64-8.14-13.42-8.14H16.98C8.55 1.53 1.77 8.31 1.77 16.67v24.56c0 8.35 6.78 15.14 15.21 15.14h24.49c8.35 0 15.14-6.78 15.14-15.14V17.74Z"/></svg>`;

// Static, so the CSP can pin it by hash. It only moves DOM nodes and sets image URLs
// taken from attributes the renderer already escaped; it never builds HTML from them.
const SCRIPT = `(() => {
  const grid = document.getElementById('grid');
  const cards = [...grid.children];
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const REVIEW = new Set(['new', 'changed', 'failed']);
  const $ = (id) => document.getElementById(id);
  let status = 'all';
  function filter(value) {
    if (value) status = value;
    for (const b of document.querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed', String(b.dataset.filter === status));
    const area = $('area').value;
    const words = $('search').value.toLowerCase().split(/\\s+/).filter(Boolean);
    let shown = 0;
    for (const card of cards) {
      const s = card.dataset.status;
      const text = (card.dataset.title + ' ' + card.dataset.name + ' ' + card.dataset.spec).toLowerCase();
      card.hidden = !((status === 'all' || s === status || (status === 'review' && REVIEW.has(s))) &&
        (!area || card.dataset.area === area) && words.every((w) => text.includes(w)));
      if (!card.hidden) shown += 1;
    }
    $('empty').hidden = shown > 0;
    $('shown').textContent = shown === cards.length ? '' : shown + ' of ' + cards.length + ' shown';
  }
  $('area').addEventListener('change', () => filter());
  $('search').addEventListener('input', () => filter());
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

  const viewer = $('viewer');
  let list = [];
  let index = 0;
  let view = 'pr';
  function show() {
    const card = list[index];
    const main = card.dataset.main || '';
    // Keep the reader's Main/PR choice for the next changed frame.
    const shown = main ? view : 'pr';
    const src = shown === 'main' ? main : card.dataset.src;
    $('v-img').src = src;
    $('v-img').alt = card.dataset.title + (shown === 'main' ? ' (main)' : '');
    $('v-open').href = src;
    $('v-title').textContent = card.dataset.title;
    $('v-count').textContent = (index + 1) + ' / ' + list.length;
    $('v-tags').replaceChildren(card.querySelector('.tags').cloneNode(true));
    $('v-compare').hidden = !main;
    for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === shown));
    $('v-prev').disabled = index === 0;
    $('v-next').disabled = index === list.length - 1;
    // A focused button that becomes disabled drops focus; keep it inside the dialog.
    if (document.activeElement && document.activeElement.disabled) $('v-stage').focus();
    $('v-stage').scrollTop = 0;
    history.replaceState(null, '', '#' + encodeURIComponent(card.dataset.name));
  }
  function open(card) {
    list = cards.filter((c) => !c.hidden);
    if (!list.includes(card)) list = cards;
    index = list.indexOf(card);
    view = 'pr';
    show();
    if (!viewer.open) viewer.showModal();
  }
  function move(step) {
    const next = index + step;
    if (next < 0 || next >= list.length) return;
    index = next;
    show();
  }
  for (const card of cards) {
    card.querySelector('.shot').addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      open(card);
    });
  }
  $('v-prev').addEventListener('click', () => move(-1));
  $('v-next').addEventListener('click', () => move(1));
  $('v-close').addEventListener('click', () => viewer.close());
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => { view = b.dataset.view; show(); });
  viewer.addEventListener('click', (event) => { if (event.target === viewer) viewer.close(); });
  viewer.addEventListener('close', () => history.replaceState(null, '', location.pathname + location.search));
  document.addEventListener('keydown', (event) => {
    if (!viewer.open || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    else if ((event.key === 'm' || event.key === 'M') && list[index].dataset.main) { view = view === 'main' ? 'pr' : 'main'; show(); }
  });
  let wanted = '';
  try { wanted = decodeURIComponent(location.hash.slice(1)); } catch {}
  const linked = cards.find((c) => c.dataset.name === wanted);
  if (linked) open(linked);
})();`;
const SCRIPT_HASH = createHash('sha256').update(SCRIPT).digest('base64');

const STYLE = `
:root{color-scheme:dark;--bg:#09090b;--fg:#f4f4f5;--muted:#a1a1aa;--line:#27272a;--card:#111113;--well:#18181b;--accent:#16a34a;--accent-soft:#14532d;--accent-fg:#bbf7d0}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg) radial-gradient(1200px 480px at 50% -140px,#123d24 0%,transparent 70%) no-repeat;color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1760px;margin:0 auto;padding:40px 16px 64px}
@media (min-width:720px){.wrap{padding:56px 48px 80px}}
.brand{display:flex;align-items:center;gap:10px;margin:0 0 20px;color:#86efac;font-size:13px;font-weight:700;letter-spacing:.22em;text-transform:uppercase}
.brand svg{width:28px;height:28px;flex:none}
.brand b{color:var(--fg);letter-spacing:.02em;font-size:17px;text-transform:none}
.top{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-end;justify-content:space-between}
h1{margin:0;font-size:clamp(36px,6vw,76px);line-height:1;letter-spacing:-.04em;font-weight:800}
.pr-title{margin:18px 0 0;font-size:20px;font-weight:600;max-width:70ch;overflow-wrap:anywhere}
.lede{margin:8px 0 0;color:var(--muted);font-size:16px;overflow-wrap:anywhere}
.lede code{font:14px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fg);background:var(--well);border:1px solid var(--line);border-radius:6px;padding:1px 6px}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.pill,button,.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:6px 16px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.03);color:var(--fg);font:inherit;text-decoration:none;cursor:pointer}
.pill{cursor:default}
a.pill{cursor:pointer}
a.pill:hover,button:hover:not(:disabled),.btn:hover{border-color:#52525b}
button:disabled{opacity:.35;cursor:default}
a:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.pill.ok{color:#86efac}.pill.bad{color:#fca5a5}
.meta{margin-top:36px;justify-content:space-between}
.filters{margin:20px 0 28px;justify-content:space-between}
.field{display:inline-flex;align-items:center;gap:8px;color:var(--muted);font-size:14px}
select,input[type=search]{min-height:40px;padding:6px 14px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--fg);font:inherit}
input[type=search]{width:min(260px,70vw)}
#shown{color:var(--muted);font-size:14px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
[aria-pressed=true]{background:var(--accent)!important;border-color:var(--accent)!important;color:#fff!important}
.density{gap:4px;padding:4px;border:1px solid var(--line);border-radius:12px}
.density button{min-height:36px;padding:0 10px;border:0;border-radius:8px;background:none}
.density svg{display:block;width:20px;height:16px;fill:currentColor}
main{display:grid;gap:24px;grid-template-columns:repeat(var(--cols,3),minmax(0,1fr))}
@media (max-width:719px){main{grid-template-columns:1fr!important}.density{display:none}}
article{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:18px;background:var(--card);overflow:hidden}
article[hidden]{display:none}
.shot{display:flex;align-items:center;justify-content:center;aspect-ratio:16/12;padding:16px;background:var(--well);border-bottom:1px solid var(--line);cursor:zoom-in}
.shot img{display:block;max-width:100%;max-height:100%;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.45);object-fit:contain;object-position:top}
.body{display:flex;gap:16px;align-items:center;padding:20px}
.num{flex:none;display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:var(--accent-soft);color:var(--accent-fg);font-weight:700}
.info{min-width:0}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
.tag{padding:2px 8px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
.t-checkpoint{background:#1e3a5f;color:#bfdbfe}.t-failure,.t-failed{background:#5c1d24;color:#fecaca}
.t-changed{background:#5a3d0f;color:#fcd34d}.t-new{background:var(--accent-soft);color:var(--accent-fg)}.t-unchanged{background:#27272a;color:var(--muted)}
h2{margin:0 0 4px;font-size:19px;line-height:1.25}
.mono{margin:0;color:var(--muted);font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mono a{color:#86efac}
#empty{padding:48px;color:var(--muted);text-align:center}
footer{margin-top:48px;color:var(--muted);font-size:13px;text-align:center}
footer a{color:var(--muted)}
dialog{width:100vw;max-width:100vw;height:100vh;max-height:100vh;margin:0;padding:0;border:0;background:rgba(9,9,11,.96);color:var(--fg)}
dialog::backdrop{background:rgba(0,0,0,.7)}
dialog[open]{display:flex;flex-direction:column}
.v-bar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line)}
.v-head{display:flex;flex-wrap:wrap;gap:12px;align-items:center;min-width:0}
.v-head h2{margin:0;font-size:18px}
.v-head .tags{margin:0}
#v-count{color:var(--muted);font-variant-numeric:tabular-nums}
.v-body{position:relative;flex:1;min-height:0;display:flex;align-items:stretch}
#v-stage{flex:1;overflow:auto;padding:16px 72px;text-align:center}
#v-stage img{max-width:100%;height:auto;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.5)}
.v-nav{position:absolute;top:50%;transform:translateY(-50%);width:48px;height:48px;padding:0;font-size:24px;background:rgba(24,24,27,.9)}
#v-prev{left:12px}#v-next{right:12px}
.v-hint{margin:0;padding:8px;color:var(--muted);font-size:12px;text-align:center;border-top:1px solid var(--line)}
.compare{gap:0;padding:3px;border:1px solid var(--line);border-radius:999px}
.compare button{min-height:32px;border:0;padding:4px 14px}
@media (max-width:719px){#v-stage{padding:12px}.v-nav{top:auto;bottom:44px;transform:none}}
`;

const ICONS = ['M2 2h16v12H2z', 'M2 2h7v12H2zM11 2h7v12h-7z', 'M1 2h5v12H1zM7.5 2h5v12h-5zM14 2h5v12h-5z', 'M1 2h3.5v12H1zM5.8 2h3.5v12H5.8zM10.7 2h3.5v12h-3.5zM15.5 2H19v12h-3.5z'];

/** The visual review page. `gallery` comes from prepare(); every value is escaped. */
export function renderGallery(gallery) {
  const { shots, removed = [], sha, runUrl, result, prNumber = '', prUrl = '', pr = null, baseline = null, generatedAt } = gallery;
  const c = counts(shots);
  const heading = prNumber ? `PR #${prNumber} screenshots` : 'main screenshots';
  const areaCounts = new Map();
  for (const shot of shots) areaCounts.set(shot.area || 'tour', (areaCounts.get(shot.area || 'tour') ?? 0) + 1);
  const areas = [...areaCounts].sort(([x], [y]) => x.localeCompare(y));
  const cards = shots
    .map((shot, i) => {
      const src = `images/${encodeURIComponent(shot.name)}`;
      const label = escapeHtml(shot.title || title(shot.name));
      const tags = [shot.kind, shot.status === 'failed' || shot.status === 'unknown' ? '' : shot.status]
        .filter(Boolean)
        .map((t) => `<span class="tag t-${t}">${TAG[t]}</span>`)
        .join('');
      const what = shot.kind === 'failure' ? 'Captured when the test failed' : shot.spec ? 'E2E checkpoint' : 'Page tour';
      const source = shot.spec ? `tests/${shot.spec}` : shot.name;
      const mainSrc = shot.status === 'changed' && baseline?.imagesUrl ? `${baseline.imagesUrl}/${encodeURIComponent(shot.name)}` : '';
      const main = mainSrc ? `<p class="mono"><a href="${escapeHtml(mainSrc)}">Open main version</a></p>` : '';
      return `<article data-status="${shot.status}" data-name="${escapeHtml(shot.name)}" data-src="${escapeHtml(src)}" data-title="${label}" data-spec="${escapeHtml(shot.spec || '')}" data-area="${escapeHtml(shot.area || 'tour')}" data-main="${escapeHtml(mainSrc)}"><a class="shot" href="${src}" aria-label="View ${label}"><img src="${src}" alt="${label}" loading="lazy"></a>
<div class="body"><span class="num">${String(i + 1).padStart(2, '0')}</span><div class="info"><div class="tags">${tags}</div><h2>${label}</h2>
<p class="mono" title="${escapeHtml(source)}">${what} · ${escapeHtml(source)}</p><p class="mono">SHA-256 ${shot.sha256.slice(0, 12)}</p>${main}</div></div></article>`;
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
  const byline = [
    pr?.author ? `by <strong>@${escapeHtml(pr.author)}</strong>` : '',
    pr?.head && pr?.base ? `<code>${escapeHtml(pr.head)}</code> → <code>${escapeHtml(pr.base)}</code>` : '',
  ].filter(Boolean).join(' · ');
  const intro = pr?.title
    ? `<p class="pr-title">${escapeHtml(pr.title)}</p>${byline ? `<p class="lede">${byline}</p>` : ''}`
    : `<p class="lede">Review intentional checkpoints separately from automatic failure captures.</p>`;
  const filter = (key, text) => `<button type="button" data-filter="${key}" aria-pressed="false">${text} (${c[key]})</button>`;
  const csp = `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'sha256-${SCRIPT_HASH}'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${escapeHtml(heading)} · Supercheck</title>
<style>${STYLE}</style></head><body><div class="wrap">
<p class="brand">${LOGO}<b>Supercheck</b><span>· Visual review</span></p>
<div class="top"><div><h1>${escapeHtml(heading)}</h1>${intro}</div>
<nav class="row" aria-label="Links">${links}</nav></div>
<div class="row meta"><div class="row">
<span class="pill ${result === 'success' ? 'ok' : 'bad'}">${escapeHtml(result)}</span>
<span class="pill" title="${escapeHtml(sha)}">${escapeHtml(sha.slice(0, 7))}</span>
<span class="pill">${shots.length} screenshots</span>
<span class="pill">${compared}</span>
${removed.length ? `<span class="pill" title="${escapeHtml(removed.join(', '))}">${removed.length} removed since main</span>` : ''}
<span class="pill">${escapeHtml(new Date(generatedAt).toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium' }))} UTC</span>
</div>
<div class="row density" role="group" aria-label="Columns">${ICONS.map((d, i) => `<button type="button" data-cols="${i + 1}" aria-pressed="false" aria-label="${i + 1} column${i ? 's' : ''}"><svg viewBox="0 0 20 16" aria-hidden="true"><path d="${d}"/></svg></button>`).join('')}</div></div>
<div class="row filters"><div class="row" role="group" aria-label="Filter">${filter('all', 'All')}${filter('review', 'Review changes')}${filter('new', 'New')}${filter('changed', 'Changed')}${filter('failed', 'Failed')}</div>
<div class="row"><label class="field"><span>Area</span><select id="area"><option value="">All areas</option>${areas.map(([a, n]) => `<option value="${escapeHtml(a)}">${escapeHtml(a)} (${n})</option>`).join('')}</select></label>
<label class="field"><span class="sr">Search</span><input id="search" type="search" placeholder="Search screenshots" autocomplete="off"></label><span id="shown" aria-live="polite"></span></div></div>
<main id="grid">
${cards}
</main><p id="empty" hidden>No screenshots match this filter.</p>
<footer>Seeded demo data from a throwaway Supercheck instance · Generated by the PR Screenshots workflow</footer>
</div>
<dialog id="viewer" aria-labelledby="v-title">
<div class="v-bar"><div class="v-head"><span id="v-count"></span><h2 id="v-title"></h2><div id="v-tags"></div></div>
<div class="row"><div class="row compare" id="v-compare" role="group" aria-label="Version" hidden><button type="button" data-view="pr" aria-pressed="true">This PR</button><button type="button" data-view="main" aria-pressed="false">Main</button></div>
<a class="btn" id="v-open" target="_blank" rel="noopener">Open image</a><button type="button" id="v-close" aria-label="Close viewer">✕</button></div></div>
<div class="v-body"><button type="button" class="v-nav" id="v-prev" aria-label="Previous screenshot">‹</button><div id="v-stage" tabindex="-1"><img id="v-img" alt=""></div><button type="button" class="v-nav" id="v-next" aria-label="Next screenshot">›</button></div>
<p class="v-hint">← → move · M toggles main · Esc closes</p>
</dialog>
<script>${SCRIPT}</script></body></html>
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
      // GitHub aligns inline images on their bottom edge, so one tall full-page frame leaves
      // gaps beside it. Preview frames of normal proportions; the page shows the rest.
      const preview = shots.filter((s) => s.status !== 'unchanged' && !(s.height > s.width * 1.2)).slice(0, THUMBNAILS);
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

/** Short summary for the publisher's GitHub Actions job summary page. */
export function renderSummary(gallery, { galleryUrl, latestUrl }) {
  const { shots, removed = [], baseline = null, prNumber = '', result } = gallery;
  const c = counts(shots);
  const lines = [`## ${prNumber ? `PR #${prNumber}` : 'main'} visual review`, ''];
  if (galleryUrl) {
    lines.push(`**[Open the visual review](${galleryUrl})**${latestUrl ? ` · [always-latest link](${latestUrl})` : ''}`, '');
  } else {
    lines.push('Hosting is not configured; the screenshots are attached to the capture run as the `pr-screenshots` artifact.', '');
  }
  lines.push(
    '| Result | Screenshots | Changed | New | Failed | Removed |',
    '| --- | --- | --- | --- | --- | --- |',
    `| ${result === 'success' ? '✅ passed' : '❌ failed'} | ${c.all} | ${baseline ? c.changed : '–'} | ${baseline ? c.new : '–'} | ${c.failed} | ${baseline ? removed.length : '–'} |`,
    '',
    baseline ? `Compared with main \`${baseline.sha.slice(0, 7)}\`.` : prNumber ? 'No main baseline to compare with yet.' : 'Main branch run.',
  );
  const review = shots.filter((s) => s.status === 'failed' || s.status === 'changed' || s.status === 'new').slice(0, 30);
  if (review.length) {
    lines.push('', '### Needs review', '');
    for (const shot of review) {
      // Names are kebab-case by validation; titles are free text, so keep them out of markdown links.
      const label = `\`${shot.status}\` ${(shot.title || title(shot.name)).replace(/[[\]()`<>|*_\\]/g, ' ')}`;
      lines.push(galleryUrl ? `- ${label} – [view](${galleryUrl}#${encodeURIComponent(shot.name)})` : `- ${label}`);
    }
  }
  return lines.join('\n');
}

/** A tiny page at a stable URL that forwards to the newest gallery for a PR or for main. */
export function renderLatest(target) {
  const href = escapeHtml(target);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'">
<meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${href}">
<title>Latest visual review · Supercheck</title></head><body><p><a href="${href}">Open the latest visual review</a></p></body></html>
`;
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
    const prInfo = process.env.PR_INFO ? await readFile(process.env.PR_INFO, 'utf8').catch(() => null) : null;
    const pr = prInfo === null ? null : parsePullRequest(prInfo);

    let baseline = null;
    if (baselinePath) {
      const text = await readFile(baselinePath, 'utf8').catch(() => null);
      baseline = text === null ? null : parseBaseline(text, { publicUrl });
      if (text !== null && !baseline) console.warn('Ignoring an invalid baseline manifest');
    }

    const found = await collectScreenshots(artifactDir);
    await mkdir(path.join(outDir, 'images'), { recursive: true });
    const hashed = [];
    for (const { name, source, width, height, meta } of found) {
      const target = path.join(outDir, 'images', name);
      await copyFile(source, target);
      hashed.push({ name, sha256: await sha256(target), width, height, meta });
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
      pr,
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
  if (command === 'summary' && args.length === 1) {
    const gallery = JSON.parse(await readFile(path.join(args[0], 'shots.json'), 'utf8'));
    const base = requireHttps('GALLERY_BASE_URL', process.env.GALLERY_BASE_URL, true).replace(/\/$/, '');
    process.stdout.write(`${renderSummary(gallery, {
      galleryUrl: base ? `${base}/index.html` : '',
      latestUrl: requireHttps('LATEST_URL', process.env.LATEST_URL, true),
    })}\n`);
    return;
  }
  if (command === 'latest' && args.length === 2) {
    await writeFile(args[0], renderLatest(requireHttps('TARGET', args[1])));
    return;
  }
  throw new Error('Usage: pr-screenshots.mjs prepare ARTIFACT_DIR OUT_DIR [BASELINE_MANIFEST] | comment OUT_DIR | summary OUT_DIR | latest OUT_FILE TARGET_URL');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
