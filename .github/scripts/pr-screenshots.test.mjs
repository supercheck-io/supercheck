import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  MARKER,
  MAX_BYTES,
  MAX_HEIGHT,
  MAX_WIDTH,
  collectScreenshots,
  escapeHtml,
  renderComment,
  renderGallery,
} from './pr-screenshots.mjs';

function png(width, height) {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}
const PNG = png(1440, 900);
const SHA = 'a'.repeat(40);
const RUN = 'https://github.com/o/r/actions/runs/1';

async function artifact(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pr-shots-'));
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), body);
  }
  return dir;
}

test('collects only valid kebab-case PNGs, sorted and de-duplicated', async () => {
  const dir = await artifact({
    'a/monitors-list.png': PNG,
    'b/dashboard.png': PNG,
    'c/dashboard.png': PNG,
    'd/Bad Name.png': PNG,
    'e/fake.png': Buffer.from('<svg onload=alert(1)>'),
    'f/empty.png': Buffer.alloc(0),
    'g/huge.png': Buffer.concat([PNG, Buffer.alloc(MAX_BYTES)]),
    'h/x"onerror=alert(1).png': PNG,
    'i/notes.txt': 'hi',
    'j/wide.png': png(MAX_WIDTH + 1, 10),
    'k/tall.png': png(10, MAX_HEIGHT + 1),
    'l/truncated.png': PNG.subarray(0, 16),
  });
  await symlink('/etc/passwd', path.join(dir, 'linked.png'));
  const shots = await collectScreenshots(dir);
  assert.deepEqual(shots.map((s) => s.name), ['dashboard.png', 'monitors-list.png']);
});

test('gallery and comment escape everything they print', () => {
  assert.equal(escapeHtml('<a href="x">\'&'), '&#60;a href=&#34;x&#34;&#62;&#39;&#38;');
  const html = renderGallery(['dashboard-dark.png'], { sha: SHA, runUrl: RUN });
  assert.match(html, /images\/dashboard-dark\.png/);
  assert.match(html, /<figcaption>dashboard dark<\/figcaption>/);

  // The renderers must escape on their own, even for names that skipped collectScreenshots.
  const hostile = '<img src=x onerror=alert(1)>.png';
  const gallery = renderGallery([hostile], { sha: SHA, runUrl: `${RUN}?"><script>` });
  assert.ok(!gallery.includes('<img src=x') && !gallery.includes('<script>'));
  assert.match(gallery, /&#60;img src=x onerror=alert\(1\)&#62;/);
  assert.match(gallery, /href="https:\/\/github\.com\/o\/r\/actions\/runs\/1\?&#34;&#62;&#60;script&#62;"/);
  const comment = renderComment([hostile], {
    sha: SHA,
    runUrl: RUN,
    result: 'success',
    galleryBaseUrl: 'https://shots.example.com/x',
  });
  assert.ok(!comment.includes('<img src=x'));
  assert.match(comment, /alt="&#60;img src=x onerror=alert\(1\)&#62;"/);
  assert.match(comment, /images\/%3Cimg%20src%3Dx%20onerror%3Dalert\(1\)%3E\.png/);
});

test('comment links the gallery with thumbnails when hosted', () => {
  const names = Array.from({ length: 8 }, (_, i) => `page-${i}.png`);
  const body = renderComment(names, {
    sha: SHA,
    runUrl: RUN,
    result: 'success',
    galleryBaseUrl: 'https://shots.example.com/prs/1/abc/',
  });
  assert.ok(body.startsWith(MARKER));
  assert.equal((body.match(/<img /g) ?? []).length, 6);
  assert.match(body, /\[Open all 8 screenshots\]\(https:\/\/shots\.example\.com\/prs\/1\/abc\/index\.html\)/);
  assert.doesNotMatch(body, /did not pass/);
});

test('comment falls back to the run artifact and flags failed runs', () => {
  const body = renderComment(['dashboard.png'], { sha: SHA, runUrl: RUN, result: 'failure', galleryBaseUrl: '' });
  assert.match(body, /did not pass/);
  assert.match(body, /`pr-screenshots` artifact/);
  assert.doesNotMatch(body, /<img /);
  assert.match(renderComment([], { sha: SHA, runUrl: RUN, result: 'success' }), /No screenshots were captured/);
});
