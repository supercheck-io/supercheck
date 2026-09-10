import { readdirSync, statSync, readFileSync } from 'node:fs'
import { resolve, relative, basename } from 'node:path'
import { logger } from './logger.js'

export interface DiscoveredFile {
  absolutePath: string
  relativePath: string
  filename: string
  type: 'playwright' | 'k6'
}

/**
 * Match files against a simple glob pattern.
 * Supports: ** (any depth), * (any chars in segment)
 */
function matchGlob(filePath: string, pattern: string): boolean {
  // Use safe placeholders (no regex special chars) to protect globs during escaping
  const withPlaceholders = pattern
    .replace(/\/\*\*\//g, '__GLOBSTAR_SLASH__') // Handle /**/ explicitly to support zero-or-more dirs
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '__STAR__')
    .replace(/\?/g, '__QMARK__')

  // Escape all regex-special characters in the remaining literal text
  const escaped = withPlaceholders.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

  // Restore glob wildcards as regex equivalents
  const regexStr = escaped
    .replace(/__GLOBSTAR_SLASH__/g, '(?:/|/.+/)')
    .replace(/__GLOBSTAR__/g, '.*')
    .replace(/__STAR__/g, '[^/]*')
    .replace(/__QMARK__/g, '.')

  return new RegExp(`^${regexStr}$`).test(filePath)
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build',
  'out', 'coverage', '.turbo', '.cache', '.vercel', 'vendor',
])

/**
 * Recursively walk a directory, returning all files.
 */
function walkDir(dir: string): string[] {
  const results: string[] = []

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        results.push(...walkDir(fullPath))
      } else if (entry.isFile()) {
        results.push(fullPath)
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable
  }

  return results
}

/**
 * Extract the static directory prefix from a glob pattern.
 * e.g. '_supercheck_/**\/*.pw.ts' -> '_supercheck_'
 */
function getGlobStaticPrefix(pattern: string): string | null {
  const parts = pattern.split('/')
  const staticParts: string[] = []
  for (const part of parts) {
    if (part.includes('*') || part.includes('?') || part.includes('{') || part.includes('[')) break
    staticParts.push(part)
  }
  return staticParts.length > 0 ? staticParts.join('/') : null
}

/**
 * Discover test files matching glob patterns from the config.
 */
export function discoverFiles(
  cwd: string,
  patterns: { playwright?: string; k6?: string },
): DiscoveredFile[] {
  // Collect unique root directories to walk based on glob static prefixes
  const walkRoots = new Set<string>()
  for (const pattern of [patterns.playwright, patterns.k6]) {
    if (!pattern) continue
    const prefix = getGlobStaticPrefix(pattern)
    if (prefix) {
      walkRoots.add(resolve(cwd, prefix))
    } else {
      // Fallback: no static prefix means we must walk cwd
      walkRoots.add(cwd)
    }
  }

  // Deduplicate: if cwd is in the set, it subsumes everything else
  if (walkRoots.has(cwd) && walkRoots.size > 1) {
    walkRoots.clear()
    walkRoots.add(cwd)
  }

  const allFiles: string[] = []
  for (const root of walkRoots) {
    allFiles.push(...walkDir(root))
  }

  const discovered: DiscoveredFile[] = []

  for (const absPath of allFiles) {
    const relPath = relative(cwd, absPath)
    const name = basename(absPath)

    if (patterns.playwright && matchGlob(relPath, patterns.playwright)) {
      discovered.push({
        absolutePath: absPath,
        relativePath: relPath,
        filename: name,
        type: 'playwright',
      })
    } else if (patterns.k6 && matchGlob(relPath, patterns.k6)) {
      discovered.push({
        absolutePath: absPath,
        relativePath: relPath,
        filename: name,
        type: 'k6',
      })
    }
  }

  logger.debug(`Discovered ${discovered.length} test files`)
  return discovered
}

/**
 * Read a file's content as a UTF-8 string, or return null on error.
 */
export function readFileContent(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    logger.warn(`Cannot read file: ${filePath}`)
    return null
  }
}

/**
 * Get file size in bytes.
 */
export function getFileSize(filePath: string): number {
  try {
    return statSync(filePath).size
  } catch {
    return 0
  }
}
