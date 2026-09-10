/**
 * Shared utilities for test filename generation and script metadata handling.
 */

/**
 * Convert a string to a URL/filesystem-friendly slug.
 * Used for generating human-readable test filenames from titles.
 *
 * @example
 *   slugify('Homepage Check')   // 'homepage-check'
 *   slugify('load-test')        // 'load-test'
 *   slugify('  Spaced  Title ') // 'spaced-title'
 */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove non-word chars (except spaces and hyphens)
      .replace(/[\s_]+/g, '-') // Replace spaces/underscores with hyphens
      .replace(/-+/g, '-') // Collapse multiple hyphens
      .replace(/^-|-$/g, '') // Trim leading/trailing hyphens
      .slice(0, 50) || 'test' // Limit length, fallback to 'test'
  )
}

/**
 * Generate a test filename with a human-readable slug prefix.
 *
 * Format: `{slug}.{uuid}.{pw|k6}.ts`
 *
 * The slug makes files identifiable at a glance in the file explorer,
 * while the UUID ensures stable, deterministic paths that survive
 * test renames (the UUID is the canonical identifier).
 *
 * @example
 *   testFilename('019c49bd-...', 'Homepage Check', 'playwright')
 *   // → 'homepage-check.019c49bd-....pw.ts'
 */
export function testFilename(
  testId: string,
  title: string,
  testType: 'playwright' | 'k6',
): string {
  const ext = testType === 'k6' ? '.k6.ts' : '.pw.ts'
  const slug = slugify(title)
  return `${slug}.${testId}${ext}`
}

/**
 * Regex for extracting a UUID from the end of a filename stem.
 * Matches UUID v1–v7 at the end of the string or preceded by a dot separator.
 */
const UUID_EXTRACT_REGEX =
  /(?:^|\.)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/**
 * Extract the UUID from a test filename (with or without slug prefix).
 *
 * Handles both old format (`{uuid}.pw.ts`) and new format (`{slug}.{uuid}.pw.ts`).
 *
 * @returns The UUID string, or `undefined` if no UUID found.
 */
export function extractUuidFromFilename(filename: string): string | undefined {
  const base = filename.split(/[/\\]/).pop() ?? filename
  const stem = base.replace(/\.(pw|k6)\.ts$/, '')
  const match = UUID_EXTRACT_REGEX.exec(stem)
  return match ? match[1] : undefined
}

/**
 * Strip `@title` metadata from a test script.
 *
 * The `@title` annotation is a local-only developer convenience injected
 * during `supercheck pull`. It should not be included in API payloads or
 * used for diff comparison — the `title` field is the canonical source.
 *
 * Handles:
 *   - `// @title My Title\n\n` (single-line comment prefix)
 *   - `* @title My Title` inside JSDoc blocks
 */
export function stripTitleMetadata(script: string): string {
  // Strip leading single-line // @title ... and optional trailing blank line
  let result = script.replace(/^\/\/\s*@title\s+[^\n]+\n\n?/, '')
  // Strip * @title ... line from JSDoc blocks
  result = result.replace(/\n\s*\*\s*@title\s+[^\n]+/, '')
  return result
}
