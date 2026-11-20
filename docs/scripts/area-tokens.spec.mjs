// The site's area and type colours must match the app's, or the marketing site drifts (Communicate was once pink here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const site = readFileSync(new URL("../src/app/global.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../../app/src/app/globals.css", import.meta.url), "utf8");

/** Every `--name: value;` in source order, so light and dark values are both compared. */
const values = (css, name) => [...css.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, "g"))].map((m) => m[1].trim());

test("site tokens equal the app's (light and dark)", () => {
  const names = [...new Set([...site.matchAll(/--((?:automate|monitor|respond|communicate|ai|type-[a-z]+)):/g)].map((m) => m[1]))];
  assert.ok(names.includes("communicate") && names.includes("type-cyan"));
  for (const name of names) assert.deepEqual(values(site, name), values(app, name), `--${name}`);
});
