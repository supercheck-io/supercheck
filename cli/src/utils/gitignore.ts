import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const SUPERCHECK_IGNORE_ENTRIES = [
  'supercheck.config.local.ts',
  'supercheck.config.local.js',
  'supercheck.config.local.mjs',
  'supercheck.state.json.lock',
  '.supercheck-artifacts/',
  '*.supercheck-backup.*',
]

/**
 * Append only the entries a project's existing .gitignore lacks, so projects created before an entry existed
 * (traces and backups can hold session data) still ignore it. Never creates a .gitignore. Returns the added entries.
 */
export function ensureGitignoreEntries(cwd: string, entries: string[] = SUPERCHECK_IGNORE_ENTRIES): string[] {
  const path = join(cwd, '.gitignore')
  if (!existsSync(path)) return []
  try {
    const content = readFileSync(path, 'utf-8')
    const normalize = (line: string) => line.trim().replace(/^\//, '').replace(/\/$/, '')
    const present = new Set(content.split(/\r?\n/).map(normalize))
    const missing = entries.filter((entry) => !present.has(normalize(entry)))
    if (missing.length === 0) return []
    const header = !present.has('# Supercheck CLI')
    const eol = content.includes('\r\n') ? '\r\n' : '\n'
    appendFileSync(path, `${content.endsWith('\n') || content === '' ? '' : eol}${header ? `# Supercheck CLI${eol}` : ''}${missing.join(eol)}${eol}`, 'utf-8')
    return missing
  } catch { return [] }
}
