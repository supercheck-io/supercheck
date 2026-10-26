import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

// The marketing nav and solutions pages link into the docs by hand; keep those links real.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sources = {
  'site-nav.ts': read('../src/lib/site-nav.ts'),
  'solutions.ts': read('../src/lib/solutions.ts'),
  'products.ts': read('../src/lib/products.ts'),
};

const slug = (heading) =>
  heading.toLowerCase().replace(/[`*]/g, '').replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-');

function docFile(path) {
  const base = new URL(`../content/docs/${path.replace(/^\/docs\//, '')}`, import.meta.url);
  return [`${base.pathname}.mdx`, `${base.pathname}/index.mdx`].find(existsSync);
}

test('every docs link in the site nav and solutions pages points at an existing page and heading', () => {
  for (const [name, source] of Object.entries(sources)) {
    for (const [, href] of source.matchAll(/href: "(\/docs\/[^"]+)"/g)) {
      const [path, anchor] = href.split('#');
      // /docs/api and /docs/cli etc. are folder roots with an index page.
      const file = docFile(path);
      assert.ok(file, `${name}: ${href} has no docs page`);
      if (anchor) {
        const headings = [...readFileSync(file, 'utf8').matchAll(/^#{2,4} (.+)$/gm)].map(([, h]) => slug(h));
        assert.ok(headings.includes(anchor), `${name}: ${href} has no matching heading`);
      }
    }
  }
});

test('every solutions screenshot exists', () => {
  const shots = [...sources['solutions.ts'].matchAll(/shot\("([^"]+)"/g)].map(([, n]) => n);
  assert.ok(shots.length > 0);
  for (const shot of shots) {
    assert.ok(existsSync(new URL(`../public/screenshots/site/${shot}.webp`, import.meta.url)), `missing ${shot}.webp`);
  }
});

test('every solutions page is linked from the site nav', () => {
  const slugs = [...sources['solutions.ts'].matchAll(/slug: "([^"]+)"/g)].map(([, s]) => s);
  assert.equal(slugs.length, 4);
  for (const s of slugs) assert.match(sources['site-nav.ts'], new RegExp(`href: "/solutions/${s}"`));
});

test('every product page is linked from the site nav and the sitemap', () => {
  const sitemap = read('../public/sitemap.xml');
  const paths = [
    ...[...sources['products.ts'].matchAll(/slug: "([^"]+)"/g)].map(([, s]) => `/product/${s}`),
  ];
  assert.equal(paths.length, 4);
  for (const path of paths) {
    assert.match(sources['site-nav.ts'], new RegExp(`href: "${path}"`));
    assert.ok(sitemap.includes(`<loc>https://supercheck.io${path}</loc>`), `${path} missing from sitemap`);
  }
});

test('every product screenshot exists', () => {
  for (const [, shot] of sources['products.ts'].matchAll(/shot\("([^"]+)"/g)) {
    assert.ok(existsSync(new URL(`../public/screenshots/site/${shot}.webp`, import.meta.url)), `missing ${shot}.webp`);
  }
});
