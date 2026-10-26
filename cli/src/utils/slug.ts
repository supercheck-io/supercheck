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
type MetadataKey = 'title' | 'priority' | 'tags'

const LINE_ENTRY = new RegExp(`^\\s*\\/\\/\\s*@(${METADATA_KEYS})\\s+(\\S.*?)\\s*$`)
const DOC_ENTRY = new RegExp(`^(\\s*\\*\\s*)@(${METADATA_KEYS})\\s+(.*?)\\s*(\\*\\/)?\\s*$`)

interface Header { kind: 'line' | 'jsdoc' | 'none'; first: number; last: number }

/**
 * The header is the only place annotations live: the leading run of `// @key value` lines, or a multi-line
 * JSDoc block at the very top (after optional blank lines). Anything later in the script is never touched.
 */
function findHeader(lines: string[]): Header {
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  if (i >= lines.length) return { kind: 'none', first: 0, last: -1 }
  const top = lines[i].trimStart()
  if (top.startsWith('/**')) {
    if (top.includes('*/')) return { kind: 'none', first: 0, last: -1 } // single-line JSDoc: leave it alone
    for (let j = i + 1; j < lines.length; j++) if (lines[j].includes('*/')) return { kind: 'jsdoc', first: i, last: j }
    return { kind: 'none', first: 0, last: -1 }
  }
  let j = i
  while (j < lines.length && LINE_ENTRY.test(lines[j])) j++
  return j > i ? { kind: 'line', first: i, last: j - 1 } : { kind: 'none', first: 0, last: -1 }
}

function entryAt(header: Header, line: string, index: number): { key: string; value: string } | undefined {
  if (header.kind === 'line') {
    const m = LINE_ENTRY.exec(line)
    return m ? { key: m[1], value: m[2] } : undefined
  }
  if (header.kind === 'jsdoc' && index > header.first && index <= header.last) {
    const m = DOC_ENTRY.exec(line)
    return m ? { key: m[2], value: m[3] } : undefined
  }
  return undefined
}

/**
 * Strip `@title`, `@priority` and `@tags` annotations from the script header (see `findHeader`).
 * They are a local-only convenience injected by `supercheck pull`, not part of the test.
 */
export function stripTitleMetadata(script: string): string {
  const lines = script.split('\n')
  const header = findHeader(lines)
  if (header.kind === 'none') return script
  const out: string[] = []
  lines.forEach((line, index) => {
    const inHeader = index >= header.first && index <= header.last
    if (!inHeader || !entryAt(header, line, index)) { out.push(line); return }
    // A closing `*/` on the same line must survive.
    if (header.kind === 'jsdoc' && line.includes('*/')) out.push(' */' + (line.endsWith('\r') ? '\r' : ''))
  })
  // Old pulls left one blank line after the leading `//` run; drop it with the run.
  if (header.kind === 'line' && out[header.first]?.trim() === '') out.splice(header.first, 1)
  return out.join('\n')
}

/** Reads a header annotation's value, or `undefined` when the header has none. */
export function readScriptMetadata(script: string, key: MetadataKey): string | undefined {
  const lines = script.split('\n')
  const header = findHeader(lines)
  for (let index = header.first; index <= header.last; index++) {
    const entry = entryAt(header, lines[index], index)
    if (entry?.key === key) return entry.value.trim()
  }
  return undefined
}

/**
 * Sets a header annotation: updates an existing one, adds to a multi-line JSDoc header or to the leading
 * `// @key` run, or otherwise prepends `// @key value` plus a blank line.
 */
export function setScriptMetadata(script: string, key: MetadataKey, value: string): string {
  // Server-supplied values must stay on one line and cannot close a JSDoc block.
  value = value.replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\*\//g, '* /').trim()
  const cr = script.includes('\r\n') ? '\r' : ''
  const lines = script.split('\n')
  const header = findHeader(lines)
  for (let index = header.first; index <= header.last; index++) {
    const entry = entryAt(header, lines[index], index)
    if (entry?.key !== key) continue
    lines[index] = header.kind === 'line'
      ? `// @${key} ${value}${cr}`
      : lines[index].replace(DOC_ENTRY, (_m, head: string, _k: string, _v: string, close?: string) => `${head}@${key} ${value}${close ? ' */' : ''}${cr}`)
    return lines.join('\n')
  }
  if (header.kind === 'jsdoc') {
    lines.splice(header.first + 1, 0, ` * @${key} ${value}${cr}`)
    return lines.join('\n')
  }
  if (header.kind === 'line') {
    lines.splice(header.last + 1, 0, `// @${key} ${value}${cr}`)
    return lines.join('\n')
  }
  return `// @${key} ${value}${cr}\n${cr}\n${script}`
}
