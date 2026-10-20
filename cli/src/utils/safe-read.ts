import { lstatSync, readFileSync } from 'node:fs'

const DEFAULT_MAX_BYTES = 512 * 1024

/** Reads a regular, non-symlink file under a size cap; returns null for anything else. */
export function readSmallFile(path: string, maxBytes = DEFAULT_MAX_BYTES): string | null {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.size > maxBytes) return null
    return readFileSync(path, 'utf8')
  } catch { return null }
}
