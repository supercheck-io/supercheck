# Supercheck Documentation

The official documentation for Supercheck is available at:

[https://supercheck.io/docs](https://supercheck.io/docs)

Please refer to the official documentation for guides on deployment, configuration, and usage.

## Interactive Diagrams

Editable Archify specifications live in `diagrams/`. Their standalone HTML
artifacts live in `public/diagrams/` and are embedded in the MDX pages. Keep the
specification and HTML together when changing a diagram.

Diagram page headings, browser titles, SVG titles, card headings, guided view
labels, and iframe titles use at most two words. Archify appends "Diagram" to
the browser title during generation; run
`node scripts/check-diagram-titles.mjs --fix` after generating HTML to remove
that suffix when necessary. Run `npm run check:diagrams` before submitting
changes. The docs build runs the same check.
