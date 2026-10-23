import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const docs = new URL('../', import.meta.url);
const content = new URL('content/docs/api/', docs);
const pages = readdirSync(content, { recursive: true }).filter(path => path.endsWith('.mdx'));
let operationPages = 0;
for (const path of pages) {
  const mdx = readFileSync(new URL(path, content), 'utf8');
  const match = mdx.match(/operations=\{(\[[^\n]+?\])\}/);
  if (!match) continue;
  operationPages++;
  test(`exported API page renders its playground and operations: ${path}`, () => {
    const html = readFileSync(new URL(join('out/docs/api', path.replace(/\.mdx$/, '.html')), docs), 'utf8');
    const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)];
    assert.ok(buttons.some(([button]) => button.includes('Try in Playground')), 'API playground control is missing');
    for (const operation of JSON.parse(match[1])) {
      assert.ok(html.includes(`>${operation.method.toUpperCase()}</`), `${operation.method} label is missing`);
      assert.ok(html.includes(operation.path.split('{')[0]), `${operation.path} endpoint is missing`);
    }
  });
}
test('API acceptance covers generated operation pages', () => assert.ok(operationPages > 50));
