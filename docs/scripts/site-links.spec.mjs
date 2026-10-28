import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

// The marketing site links into the docs by hand; keep those links real.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sources = {
  'site-nav.ts': read('../src/lib/site-nav.ts'),
  'solutions.ts': read('../src/lib/solutions.ts'),
  'products.ts': read('../src/lib/products.ts'),
  'home page': read('../src/app/(home)/page.tsx'),
  'pricing page': read('../src/app/pricing/page.tsx'),
  'product page': read('../src/app/product/[product]/page.tsx'),
  'solutions page': read('../src/app/solutions/[persona]/page.tsx'),
  'site-header.tsx': read('../src/components/site-header.tsx'),
  'site-footer.tsx': read('../src/components/site-footer.tsx'),
};
// Site routes outside the docs that marketing pages may link to.
const siteRoutes = new Set(['/', '/pricing', '/privacy', '/terms']);

const slug = (heading) =>
  heading.toLowerCase().replace(/[`*]/g, '').replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-');

function docFile(path) {
  const base = new URL(`../content/docs/${path.replace(/^\/docs\//, '')}`, import.meta.url);
  return [`${base.pathname}.mdx`, `${base.pathname}/index.mdx`].find(existsSync);
}

test('every docs link on the marketing site points at an existing page and heading', () => {
  for (const [name, source] of Object.entries(sources)) {
    for (const [, href] of source.matchAll(/href(?:: |=)"(\/docs\/[^"]+)"/g)) {
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

test('every other internal link on the marketing site points at an existing route', () => {
  const productSlugs = [...sources['products.ts'].matchAll(/slug: "([^"]+)"/g)].map(([, s]) => `/product/${s}`);
  const solutionSlugs = [...sources['solutions.ts'].matchAll(/slug: "([^"]+)"/g)].map(([, s]) => `/solutions/${s}`);
  const routes = new Set([...siteRoutes, ...productSlugs, ...solutionSlugs]);
  for (const [name, source] of Object.entries(sources)) {
    for (const [, href] of source.matchAll(/href(?:: |=)"(\/(?!docs\/)[^"]*)"/g)) {
      assert.ok(routes.has(href.split('#')[0]), `${name}: ${href} is not a site route`);
    }
  }
});

test('every screenshot referenced by the site and docs exists', () => {
  const docs = new URL('../content/docs/', import.meta.url);
  const mdx = readdirSync(docs, { recursive: true }).filter((f) => f.endsWith('.mdx')).map((f) => readFileSync(new URL(f, docs), 'utf8'));
  for (const source of [...Object.values(sources), ...mdx]) {
    for (const [path] of source.matchAll(/\/screenshots\/[\w/-]+\.(?:png|webp)/g)) {
      assert.ok(existsSync(new URL(`../public${path}`, import.meta.url)), `missing ${path}`);
    }
  }
});
