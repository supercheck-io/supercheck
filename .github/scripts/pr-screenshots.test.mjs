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
  classify,
  collectScreenshots,
  escapeHtml,
  parseBaseline,
  parseMeta,
  renderLatest,
  renderSummary,
  parsePullRequest,
  renderComment,
  renderGallery,
  title,
} from './pr-screenshots.mjs';
import { createHash } from 'node:crypto';

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

const H = (c) => c.repeat(64);
const shot = (name, status = 'unknown', kind = name.startsWith('failed-') ? 'failure' : 'checkpoint') => ({ name, kind, sha256: H('a'), status });
function gallery(shots, extra = {}) {
  return { shots, removed: [], sha: SHA, runUrl: RUN, result: 'success', prNumber: '7', prUrl: 'https://github.com/o/r/pull/7', baseline: null, generatedAt: '2026-11-10T00:00:00Z', ...extra };
}
const PUBLIC = 'https://shots.example.com';
const manifest = (shots, extra = {}) => JSON.stringify({ version: 1, sha: 'b'.repeat(40), runUrl: 'https://github.com/o/r/actions/runs/9', imagesUrl: `${PUBLIC}/main/9-1/images`, shots, ...extra });

test('classify labels frames against the baseline and sorts review-worthy ones first', () => {
  const baseline = parseBaseline(
    manifest([
      { name: 'dashboard.png', sha256: H('a') },
      { name: 'jobs-list.png', sha256: H('b') },
      { name: 'gone.png', sha256: H('c') },
    ]),
    { publicUrl: PUBLIC },
  );
  const { shots, removed } = classify(
    [
      { name: 'dashboard.png', sha256: H('a') },
      { name: 'jobs-list.png', sha256: H('d') },
      { name: 'monitors-list.png', sha256: H('e') },
      { name: 'failed-variables.png', sha256: H('f') },
    ],
    baseline,
  );
  assert.deepEqual(
    shots.map((s) => `${s.kind}:${s.status}:${s.name}`),
    ['failure:failed:failed-variables.png', 'checkpoint:changed:jobs-list.png', 'checkpoint:new:monitors-list.png', 'checkpoint:unchanged:dashboard.png'],
  );
  assert.deepEqual(removed, ['gone.png']);
  // Without a baseline nothing is claimed as new or changed.
  assert.deepEqual(classify([{ name: 'a.png', sha256: H('a') }], null).shots.map((s) => s.status), ['unknown']);
  assert.equal(title('failed-org-admin.png'), 'Org Admin');
});

test('baseline manifests are validated as untrusted input', () => {
  const ok = [{ name: 'dashboard.png', sha256: H('a') }];
  assert.ok(parseBaseline(manifest(ok), { publicUrl: PUBLIC }));
  assert.equal(parseBaseline(manifest(ok), { publicUrl: PUBLIC }).imagesUrl, `${PUBLIC}/main/9-1/images`);
  for (const bad of [
    'not json',
    'null',
    manifest(ok, { version: 2 }),
    manifest(ok, { sha: 'nope' }),
    manifest([{ name: '../x.png', sha256: H('a') }]),
    manifest([{ name: 'a.png', sha256: 'short' }]),
    manifest(Array.from({ length: 801 }, (_, i) => ({ name: `p-${i}.png`, sha256: H('a') }))),
  ]) {
    assert.equal(parseBaseline(bad, { publicUrl: PUBLIC }), null, bad.slice(0, 40));
  }
  // URLs outside our bucket or GitHub are dropped, not trusted.
  const foreign = parseBaseline(manifest(ok, { imagesUrl: 'https://evil.example/x', runUrl: 'javascript:alert(1)' }), { publicUrl: PUBLIC });
  assert.equal(foreign.imagesUrl, '');
  assert.equal(foreign.runUrl, '');
  assert.equal(parseBaseline(manifest(ok, { imagesUrl: `${PUBLIC}.evil.example/x` }), { publicUrl: PUBLIC }).imagesUrl, '');
  assert.equal(parseBaseline(manifest(ok, { imagesUrl: `${PUBLIC}/main/../../other.example/x` }), { publicUrl: `${PUBLIC}/main` }).imagesUrl, '');
});

test('gallery escapes everything it prints and pins its script by hash', () => {
  assert.equal(escapeHtml('<a href="x">\'&'), '&#60;a href=&#34;x&#34;&#62;&#39;&#38;');
  const html = renderGallery(gallery([shot('dashboard-dark.png', 'changed'), shot('failed-sign-in.png', 'failed')], {
    baseline: { sha: 'b'.repeat(40), imagesUrl: `${PUBLIC}/main/9-1/images`, runUrl: 'https://github.com/o/r/actions/runs/9' },
  }));
  assert.match(html, /images\/dashboard-dark\.png/);
  assert.match(html, /<h2>Dashboard Dark<\/h2>/);
  assert.match(html, /data-status="changed"/);
  assert.match(html, /class="tag t-failure">Failure/);
  assert.match(html, /Changed \(1\)/);
  assert.match(html, /Review changes \(2\)/);
  assert.match(html, /Compared with latest successful main run \(bbbbbbb\)/);
  assert.match(html, /main\/9-1\/images\/dashboard-dark\.png">Open main version/);
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const hash = createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes(`script-src 'sha256-${hash}'`));

  // The renderer must escape on its own, even for names that skipped collectScreenshots.
  const hostile = '<img src=x onerror=alert(1)>.png';
  const page = renderGallery(gallery([shot(hostile)], { runUrl: `${RUN}?"><script>`, prNumber: '7"><b>' }));
  assert.doesNotMatch(page, /<img src=x|<script>alert|"><b>/i);
  assert.match(page, /<h2>&#60;Img Src=X Onerror=Alert\(1\)&#62;<\/h2>/);
  assert.match(page, /href="https:\/\/github\.com\/o\/r\/actions\/runs\/1\?&#34;&#62;&#60;script&#62;"/);
});

test('comment summarises changes and previews review-worthy frames first', () => {
  const shots = [shot('failed-a.png', 'failed'), shot('b.png', 'changed'), shot('c.png', 'new'), ...Array.from({ length: 8 }, (_, i) => shot(`u-${i}.png`, 'unchanged'))];
  const body = renderComment(gallery(shots, { baseline: { sha: 'b'.repeat(40) }, removed: ['gone.png'] }), {
    runUrl: RUN,
    galleryBaseUrl: 'https://shots.example.com/prs/1/abc/',
  });
  assert.ok(body.startsWith(MARKER));
  assert.match(body, /\*\*1 changed · 1 new · 1 failed\*\* · 1 removed vs main `bbbbbbb`/);
  assert.equal((body.match(/<img /g) ?? []).length, 3);
  assert.match(body, /\[Open visual review \(11 screenshots\)\]\(https:\/\/shots\.example\.com\/prs\/1\/abc\/index\.html\)/);
  assert.doesNotMatch(body, /did not pass/);

  const hostile = '<img src=x onerror=alert(1)>.png';
  const escaped = renderComment(gallery([shot(hostile, 'new')], { baseline: { sha: 'b'.repeat(40) } }), { runUrl: RUN, galleryBaseUrl: 'https://shots.example.com/x' });
  assert.doesNotMatch(escaped, /<img src=x/);
  assert.match(escaped, /alt="&#60;img src=x onerror=alert\(1\)&#62;"/);
  assert.match(escaped, /images\/%3Cimg%20src%3Dx%20onerror%3Dalert\(1\)%3E\.png/);
});

test('comment falls back to the run artifact and flags failed runs', () => {
  const body = renderComment(gallery([shot('dashboard.png')], { result: 'failure' }), { runUrl: RUN, galleryBaseUrl: '' });
  assert.match(body, /did not pass/);
  assert.match(body, /no main baseline to compare yet/);
  assert.match(body, /`pr-screenshots` artifact/);
  assert.doesNotMatch(body, /<img /);
  assert.match(renderComment(gallery([]), { runUrl: RUN }), /No screenshots were captured/);
});

test('prepare writes a checkpoint-only manifest and compares against a baseline file', async () => {
  const { execFileSync } = await import('node:child_process');
  const { readFile } = await import('node:fs/promises');
  const script = new URL('./pr-screenshots.mjs', import.meta.url).pathname;
  const dir = await artifact({ 'shots/a/dashboard.png': PNG, 'shots/b/failed-jobs-list.png': PNG });
  const baseline = path.join(dir, 'baseline.json');
  await writeFile(baseline, manifest([{ name: 'dashboard.png', sha256: H('0') }, { name: 'gone.png', sha256: H('1') }]));
  const run = (out, result) =>
    execFileSync(process.execPath, [script, 'prepare', path.join(dir, 'shots'), out, baseline], {
      env: { ...process.env, SHA, RUN_URL: RUN, RESULT: result, PR_NUMBER: '7', GALLERY_BASE_URL: `${PUBLIC}/prs/7/1-1/`, PUBLIC_URL: PUBLIC },
    });
  const out = path.join(dir, 'out');
  run(out, 'success');
  const written = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
  assert.equal(written.imagesUrl, `${PUBLIC}/prs/7/1-1/images`);
  assert.deepEqual(written.shots.map((s) => s.name), ['dashboard.png']);
  const shots = JSON.parse(await readFile(path.join(out, 'shots.json'), 'utf8'));
  assert.deepEqual(shots.shots.map((s) => s.status), ['failed', 'changed']);
  assert.deepEqual(shots.removed, ['gone.png']);
  // A failed run may not have reached every page, so nothing is reported as removed.
  run(path.join(dir, 'out2'), 'failure');
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'out2', 'shots.json'), 'utf8')).removed, []);
});

test('pull request details are bounded, validated and escaped', () => {
  const pr = parsePullRequest(JSON.stringify({ title: 'Fix <script>alert(1)</script> & co', author: 'octo-cat', head: 'fork:feat/x"><b>', base: 'main' }));
  assert.deepEqual(pr, { title: 'Fix <script>alert(1)</script> & co', author: 'octo-cat', head: 'fork:feat/x"><b>', base: 'main' });
  assert.equal(parsePullRequest(JSON.stringify({ title: 'x'.repeat(301), author: 'bad user<' })).title, '');
  assert.equal(parsePullRequest(JSON.stringify({ author: 'bad user<' })).author, '');
  assert.equal(parsePullRequest(JSON.stringify({ author: 'dependabot[bot]' })).author, 'dependabot[bot]');
  assert.equal(parsePullRequest('nope'), null);
  const html = renderGallery(gallery([shot('a.png', 'changed')], { pr }));
  assert.match(html, /<p class="pr-title">Fix &#60;script&#62;alert\(1\)&#60;\/script&#62; &#38; co<\/p>/);
  assert.match(html, /<code>fork:feat\/x&#34;&#62;&#60;b&#62;<\/code> → <code>main<\/code>/);
  assert.doesNotMatch(html, /<script>alert|"><b>/i);
  // The viewer is part of the page, and the Supercheck brand is shown.
  assert.match(html, /<dialog id="viewer"/);
  assert.match(html, /<b>Supercheck<\/b>/);
});

test('comment previews skip tall full-page frames that break GitHub layout', () => {
  const tall = { ...shot('create.png', 'new'), width: 1440, height: 3000 };
  const normal = { ...shot('dashboard.png', 'new'), width: 1440, height: 900 };
  const body = renderComment(gallery([tall, normal], { baseline: { sha: 'b'.repeat(40) } }), { runUrl: RUN, galleryBaseUrl: 'https://shots.example.com/x' });
  assert.match(body, /images\/dashboard\.png/);
  assert.doesNotMatch(body, /images\/create\.png/);
});

test('checkpoint sidecars are validated and attached to their frames', async () => {
  const dir = await artifact({
    'a/login-works-abc123.png': PNG,
    'a/login-works-abc123.checkpoint.json': JSON.stringify({ title: 'auth › Login\u0007 works', spec: 'auth/sign-in.spec.ts', area: 'auth' }),
    'b/evil-abc123.png': PNG,
    'b/evil-abc123.checkpoint.json': JSON.stringify({ title: 'x', spec: '../../etc/passwd', area: 'Bad Area' }),
    'c/huge-abc123.checkpoint.json': 'x'.repeat(5000),
  });
  const shots = await collectScreenshots(dir);
  const byName = Object.fromEntries(shots.map((s) => [s.name, s.meta]));
  assert.deepEqual(byName['login-works-abc123.png'], { title: 'auth › Login  works', spec: 'auth/sign-in.spec.ts', area: 'auth', negative: false });
  assert.deepEqual(byName['evil-abc123.png'], { title: 'x', spec: '', area: '', negative: false });
  assert.equal(parseMeta(JSON.stringify({ negative: true })).negative, true);
  assert.equal(parseMeta(JSON.stringify({ negative: 'yes' })).negative, false);
  assert.equal(parseMeta('nope'), null);
  assert.equal(parseMeta(JSON.stringify({ title: 'y'.repeat(301) })).title, '');

  const { shots: classified } = classify(shots.map((s) => ({ ...s, sha256: H('a') })), null);
  assert.equal(classified.find((s) => s.name === 'login-works-abc123.png').area, 'auth');
  assert.equal(classify([{ name: 'flow-x-1-open.png', sha256: H('a') }], null).shots[0].area, 'flows');
  assert.equal(classify([{ name: 'dashboard.png', sha256: H('a') }], null).shots[0].area, 'tour');
});

test('gallery shows test names, spec paths and an area filter', () => {
  const s = { ...shot('login-works-abc123.png', 'changed'), title: 'Login <works>', spec: 'auth/sign-in.spec.ts', area: 'auth' };
  const html = renderGallery(gallery([s, { ...shot('dashboard.png'), area: 'tour' }]));
  assert.match(html, /<h2>Login &#60;works&#62;<\/h2>/);
  assert.match(html, /tests\/auth\/sign-in\.spec\.ts/);
  assert.match(html, /<option value="auth">auth \(1\)<\/option>/);
  assert.match(html, /id="search"/);
});

test('frames from negative tests are labelled, failures never are', () => {
  const { shots } = classify(
    [
      { name: 'rejects-bad-input-abc123.png', sha256: H('a'), meta: { title: 'x', spec: 'a/b.spec.ts', area: 'a', negative: true } },
      { name: 'flow-invalid-monitor-url-1-error.png', sha256: H('b') },
      { name: 'failed-rejects-bad-input-abc123.png', sha256: H('c'), meta: { negative: true } },
      { name: 'flow-create-monitor-1-filled.png', sha256: H('d') },
    ],
    null,
  );
  const by = Object.fromEntries(shots.map((s) => [s.name, s.negative]));
  assert.deepEqual(by, {
    'rejects-bad-input-abc123.png': true,
    'flow-invalid-monitor-url-1-error.png': true,
    'failed-rejects-bad-input-abc123.png': false,
    'flow-create-monitor-1-filled.png': false,
  });
  const html = renderGallery(gallery(shots));
  assert.equal(html.match(/<span class="tag t-expected">Negative test<\/span>/g).length, 2);
  assert.match(html, /Negative test: the app is meant to refuse or show an error here/);
});

test('job summary links the gallery and lists frames that need review', () => {
  const shots = [{ ...shot('a.png', 'changed'), title: 'Pay [now](javascript:x)' }, shot('b.png', 'unchanged')];
  const md = renderSummary(gallery(shots, { baseline: { sha: 'b'.repeat(40) } }), { galleryUrl: 'https://x.example/g/index.html', latestUrl: 'https://x.example/prs/7/index.html' });
  assert.match(md, /\[Open the visual review\]\(https:\/\/x\.example\/g\/index\.html\)/);
  assert.match(md, /\| ✅ passed \| 2 \| 1 \| 0 \| 0 \| 0 \|/);
  assert.match(md, /- `changed` Pay  now  javascript x  – \[view\]\(https:\/\/x\.example\/g\/index\.html#a\.png\)/);
  assert.doesNotMatch(md, /b\.png/);
  assert.match(renderSummary(gallery([]), { galleryUrl: '' }), /pr-screenshots/);
});

test('latest page forwards to the gallery with an escaped URL', () => {
  const html = renderLatest('https://x.example/prs/7/1-1/index.html?"><script>');
  assert.match(html, /http-equiv="refresh" content="0; url=https:\/\/x\.example\/prs\/7\/1-1\/index\.html\?&#34;&#62;&#60;script&#62;"/);
  assert.doesNotMatch(html, /<script>/i);
});
