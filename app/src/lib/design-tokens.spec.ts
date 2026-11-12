import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Ratchet for DESIGN.md: raw Tailwind palette colours (text-green-500, bg-amber-100, ...) must not grow.
 * New code uses tokens (text-success, bg-ai/10, TableBadge tones). When you remove raw colours, lower
 * BASELINE to the new count printed by the failure message, never raise it.
 */
const BASELINE = 694;
/** Raw neutral greys (text-gray-500, bg-zinc-100, ...) have their own ratchet; use muted-foreground, border, muted, accent. */
const NEUTRAL_BASELINE = 197;

const SRC = join(__dirname, "..");
const UTILITIES = "text|bg|border|ring|fill|stroke|from|via|to|outline|divide|accent|caret|decoration";
const RAW_PALETTE = new RegExp(
  `\\b(?:${UTILITIES})-(?:red|green|blue|yellow|amber|emerald|purple|violet|orange|sky|indigo|pink|rose|teal|cyan|lime|fuchsia)-\\d{2,3}\\b`,
  "g",
);
const RAW_NEUTRAL = new RegExp(`\\b(?:${UTILITIES})-(?:slate|gray|zinc|neutral|stone)-\\d{2,3}\\b`, "g");

// Exempt: emails need inline colours, logos are brand marks, and central maps are where palette
// shades are allowed to live (DESIGN.md section 4). The public status pages are customer branding.
const EXEMPT = [
  /^emails\//,
  /^components\/logo\//,
  /^components\/ui\/table-badge\.tsx$/,
  /^components\/ui\/alert\.tsx$/,
  /^components\/ui\/icon-chip\.tsx$/,
  /^components\/ui\/tag-selector\.tsx$/,
  /^components\/status-pages\/public-/,
  /\.spec\.tsx?$/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

export function countRaw(pattern: RegExp): { total: number; byFile: Array<[string, number]> } {
  const byFile: Array<[string, number]> = [];
  for (const file of sourceFiles(SRC)) {
    // Normalise to "/" so the EXEMPT patterns also match on Windows.
    const rel = relative(SRC, file).split(sep).join("/");
    if (EXEMPT.some((pattern) => pattern.test(rel))) continue;
    const count = readFileSync(file, "utf8").match(pattern)?.length ?? 0;
    if (count) byFile.push([rel, count]);
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total: byFile.reduce((sum, [, n]) => sum + n, 0), byFile };
}

it("does not add raw palette colours outside the DESIGN.md exemptions", () => {
  expectWithinBaseline("Raw palette colours", RAW_PALETTE, BASELINE);
});

it("does not add raw neutral greys outside the DESIGN.md exemptions", () => {
  expectWithinBaseline("Raw neutral greys", RAW_NEUTRAL, NEUTRAL_BASELINE);
});

function expectWithinBaseline(label: string, pattern: RegExp, baseline: number) {
  const { total, byFile } = countRaw(pattern);
  const top = byFile.slice(0, 5).map(([file, n]) => `${file}: ${n}`).join(", ");
  if (total > baseline) {
    throw new Error(`${label} rose to ${total} (baseline ${baseline}). Use DESIGN.md tokens instead. Top files: ${top}`);
  }
  expect(total).toBeLessThanOrEqual(baseline);
}

it("matches the palette pattern on class names and ignores tokens", () => {
  expect("text-green-500 bg-amber-100 dark:text-rose-300".match(RAW_PALETTE)).toHaveLength(3);
  expect("text-success bg-ai/10 text-muted-foreground border-failure/30".match(RAW_PALETTE)).toBeNull();
  expect("text-gray-500 bg-zinc-100 text-muted-foreground".match(RAW_NEUTRAL)).toHaveLength(2);
});
