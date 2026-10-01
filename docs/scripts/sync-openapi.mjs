import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { isDeepStrictEqual } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'openapi.json'), 'utf8');
const spec = JSON.parse(source);
const targets = ['public/openapi/openapi.json', '../app/public/openapi.json', 'public/openapi/openapi.yaml'];
export function syncOpenApi({ check = false } = {}) {
  for (const target of targets) {
    const path = resolve(root, target);
    if (check) {
      const published = readFileSync(path, 'utf8');
      const parsed = target.endsWith('.yaml') ? parse(published) : JSON.parse(published);
      if (!isDeepStrictEqual(parsed, spec)) {
        console.error(`${target} differs from docs/openapi.json; run npm run sync:openapi in docs.`);
        process.exitCode = 1;
      }
    } else {
      writeFileSync(path, target.endsWith('.yaml') ? stringify(spec) : source);
    }
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncOpenApi({ check: process.argv.includes('--check') });
}
