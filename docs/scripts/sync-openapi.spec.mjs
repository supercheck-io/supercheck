import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

test('the public API source and published copies intentionally exclude hosted billing endpoints', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  for (const target of ['openapi.json', 'public/openapi/openapi.json', '../app/public/openapi.json', 'public/openapi/openapi.yaml']) {
    const spec = parse(readFileSync(resolve(root, target), 'utf8'));
    assert.ok(Object.keys(spec.paths).length > 0);
    assert.ok(Object.keys(spec.paths).every((path) => !/^\/api\/billing(?:\/|$)/.test(path)), target);
  }
});

test('OpenAPI sync is explicit, compares values independently of key order, and detects drift', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'supercheck-openapi-'));
  try {
    const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const root = join(fixture, 'docs');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'public/openapi'), { recursive: true });
    mkdirSync(join(fixture, 'app/public'), { recursive: true });
    symlinkSync(join(docsRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
    const script = join(root, 'scripts/sync-openapi.mjs');
    copyFileSync(join(docsRoot, 'scripts/sync-openapi.mjs'), script);
    const spec = { info: { title: 'Supercheck' }, paths: {} };
    writeFileSync(join(root, 'openapi.json'), JSON.stringify(spec));
    const targets = [join(root, 'public/openapi/openapi.json'), join(fixture, 'app/public/openapi.json'), join(root, 'public/openapi/openapi.yaml')];
    for (const path of targets) writeFileSync(path, 'unchanged');
    const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(script).href)})`], { encoding: 'utf8' });
    assert.equal(imported.status, 0, imported.stderr);
    assert.ok(targets.every((path) => readFileSync(path, 'utf8') === 'unchanged'));
    for (const path of targets) writeFileSync(path, JSON.stringify({ paths: {}, info: { title: 'Supercheck' } }));
    assert.equal(spawnSync(process.execPath, [script, '--check']).status, 0);
    writeFileSync(targets[0], JSON.stringify({ ...spec, info: { title: 'Different' } }));
    assert.equal(spawnSync(process.execPath, [script, '--check']).status, 1);
    assert.equal(spawnSync(process.execPath, [script]).status, 0);
    for (const path of targets) assert.deepEqual(parse(readFileSync(path, 'utf8')), spec);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
