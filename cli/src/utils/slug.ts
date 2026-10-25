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
  const stem = base.replace(/\.(?:pw|k6|spec)\.[jt]s$/, '')
  const match = UUID_EXTRACT_REGEX.exec(stem)
  return match ? match[1] : undefined
}

/** Local-only annotations injected by `supercheck pull`; stripped before diff and deploy. */
const METADATA_KEYS = 'title|priority|tags'

/**
 * Strip `@title`, `@priority` and `@tags` metadata from a test script.
 *
 * These annotations are a local-only developer convenience injected
 * during `supercheck pull`. They should not be included in API payloads or
 * used for diff comparison — the test's own fields are the canonical source.
 *
 * Handles:
 *   - leading `// @title My Title` lines (any of the keys) followed by an optional blank line
 *   - `* @title My Title` lines inside JSDoc blocks
 */
export function stripTitleMetadata(script: string): string {
  let result = script.replace(new RegExp(`^(?:\\/\\/\\s*@(?:${METADATA_KEYS})\\s+[^\\n]+\\n)+\\n?`), '')
  result = result.replace(new RegExp(`\\n\\s*\\*\\s*@(?:${METADATA_KEYS})\\s+[^\\n]+`, 'g'), '')
  return result
}

/** Reads a metadata annotation's value (`// @key value` or ` * @key value`). */
export function readScriptMetadata(script: string, key: 'title' | 'priority' | 'tags'): string | undefined {
  const match = script.match(new RegExp(`@${key}\\s+(.+)$`, 'm'))
  return match ? match[1].replace(/\s*\*\/\s*$/, '').trim() : undefined
}

/**
 * Sets a metadata annotation, updating an existing one, injecting into an existing JSDoc block,
 * appending to leading `// @key` lines, or prepending `// @key value` and a blank line.
 */
export function setScriptMetadata(script: string, key: 'title' | 'priority' | 'tags', value: string): string {
  const existing = new RegExp(`(@${key}\\s+)(.+?)(\\r?\\n|\\*\\/|$)`)
  if (existing.test(script)) return script.replace(existing, (_match, head: string, _old: string, tail: string) => `${head}${value}${tail}`)
  if (/\/\*\*([\s\S]*?)\*\//.test(script)) return script.replace(/(\/\*\*)/, (open: string) => `${open}\n * @${key} ${value}`)
  const leading = script.match(new RegExp(`^(?:\\/\\/\\s*@(?:${METADATA_KEYS})\\s+[^\\n]+\\n)+`))
  if (leading) return `${leading[0]}// @${key} ${value}\n${script.slice(leading[0].length)}`
  return `// @${key} ${value}\n\n${script}`
}
