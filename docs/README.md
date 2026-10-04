# Supercheck Documentation

The official documentation for Supercheck is available at:

[https://supercheck.io/docs](https://supercheck.io/docs)

Please refer to the official documentation for guides on deployment, configuration, and usage.

## Interactive Diagrams

Editable Archify specifications live in `diagrams/`. Their standalone HTML
artifacts live in `public/diagrams/` and are embedded in the MDX pages. Keep the
specification and HTML together when changing a diagram.

Diagram page headings, browser titles, SVG titles, card headings, guided view
labels, and iframe titles use at most two words. Archify's generated "Diagram"
suffix is permitted in the browser title. Run `npm run check:diagrams` before
submitting changes. The docs build runs the same read-only check.

## OpenAPI and local checks

Use Node.js 22 or newer. `openapi.json` is the manually maintained public API
source; deployment-specific service endpoints are intentionally excluded from it and all
published copies. Update it alongside route changes; it is not generated from
route handlers. `npm run sync:openapi`
updates the published JSON/YAML copies and the app's copy. `npm run generate-docs`
explicitly syncs those copies and regenerates API pages, excluding deployment-specific
pages. `npm run check:openapi` checks semantic parity without writing files.
Run `npm run test:openapi`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`
before submitting docs changes.

`fumadocs-openapi` is pinned to 10.6.8. The published 10.8.6 package fails API
generation on Node 22 with a missing `require_js2xml` export in its bundled
`xml-js` module. Upgrade once a published version passes API generation,
TypeScript, and the production build; do not patch installed package files.

## Static Docker preview

From the repository root, run `docker build -f docs/Dockerfile -t supercheck-docs .`
then `docker run --rm -p 3000:3000 supercheck-docs`. The image serves the static
export, including search and diagram embeds. The Dockerfile-specific ignore
file excludes local dependencies, builds, and environment files.

Cloudflare Pages remains the production host. Its `/api/proxy` Function supports
the API playground; the static Docker preview does not provide that proxy.
Use the Cloudflare deployment to test playground requests. `npm start` (Next.js
server mode) is incompatible with this site's `output: 'export'` configuration.
