import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { versioned } from "../src/lib/assets.ts";

// Run from docs/ (npm scripts do): the helper reads public/ relative to the working directory.
test("screenshot URLs carry a hash of the file bytes, so a recapture changes the URL", () => {
  const src = "/screenshots/site/incident-workspace-overview.webp";
  const hash = createHash("sha256").update(readFileSync(`public${src}`)).digest("hex").slice(0, 10);
  assert.equal(versioned(src), `${src}?v=${hash}`);
  assert.match(versioned("/supercheck-screenshot.webp"), /^\/supercheck-screenshot\.webp\?v=[0-9a-f]{10}$/);
});

test("other URLs pass through unchanged", () => {
  assert.equal(versioned("/supercheck-logo.png"), "/supercheck-logo.png");
  assert.equal(versioned("https://example.com/a.png"), "https://example.com/a.png");
});

test("a missing screenshot fails loudly instead of shipping a broken URL", () => {
  assert.throws(() => versioned("/screenshots/site/does-not-exist.webp"), /ENOENT/);
});
