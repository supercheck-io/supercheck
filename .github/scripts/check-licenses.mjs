import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const json = (path) => JSON.parse(read(path));

// Separate Docker contexts need their own copies of the canonical notices.
for (const component of ['app', 'worker']) {
  assert.equal(read(`${component}/LICENSE`), read('LICENSE'), `${component} LICENSE drift`);
  assert.equal(read(`${component}/NOTICE`), read('NOTICE'), `${component} NOTICE drift`);
  assert.match(read(`${component}/Dockerfile`), new RegExp(`COPY --from=builder .* /${component}/LICENSE /${component}/NOTICE ./`));
}

for (const component of ['app', 'worker', 'docs']) {
  assert.equal(json(`${component}/package.json`).license, 'AGPL-3.0-only', `${component} license`);
}
for (const component of ['cli', 'recorder']) {
  assert.equal(json(`${component}/package.json`).license, 'Apache-2.0', `${component} license`);
}
assert.equal(read('cli/LICENSE'), read('recorder/LICENSE'), 'Apache license drift');

const cli = json('cli/package.json');
const lock = json('cli/package-lock.json');
assert.equal(lock.version, cli.version, 'CLI lockfile version');
assert.equal(lock.packages[''].version, cli.version, 'CLI root package version');
assert.equal(lock.packages[''].license, cli.license, 'CLI lockfile license');
assert.ok(cli.files.includes('NOTICE'), 'CLI NOTICE must be packaged');

assert.match(read('NOTICE'), /Copyright \(C\) 2026 Krishna Kant/);
assert.match(read('recorder/NOTICE'), /Copyright \(c\) 2026 Krishna Kant/);
assert.match(read('recorder/NOTICE'), /Copyright \(c\) Rui Figueira/);
assert.match(read('recorder/playwright/NOTICE'), /Microsoft/);

console.log('Licenses, notices, and package metadata are consistent.');
