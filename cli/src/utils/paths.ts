import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { CLIError, ExitCode } from './errors.js'
import { testFilename } from './slug.js'

export type LocalTestType = 'playwright' | 'k6'

export function testTypeToFolder(testType: LocalTestType): string {
  return testType === 'k6' ? 'k6' : 'playwright'
}

export function testRelativePath(
  testId: string,
  title: string,
  testType: LocalTestType,
): string {
  const folder = testTypeToFolder(testType)
  const filename = testFilename(testId, title, testType)
  return `_supercheck_/${folder}/${filename}`
}
// Lowercase only: the server emits lowercase IDs, and accepting case variants would let two IDs share a file on
// case-insensitive filesystems or break rename detection.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Resource IDs become file names; only canonical UUIDs are accepted so a server cannot smuggle path segments. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** Resolve symlinks in the deepest existing ancestor, then re-append the not-yet-created remainder. */
function realish(path: string): string {
  const tail: string[] = []
  let current = resolve(path)
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) return resolve(path)
    tail.unshift(basename(current))
    current = parent
  }
  return resolve(realpathSync(current), ...tail)
}

const isOutside = (rel: string): boolean => rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)

/**
 * Resolve `target` against `root` and refuse anything that lands outside it: traversal, absolute paths, a symlinked
 * parent directory that leaves the root, or a destination that is itself a symlink.
 */
export function resolveWithin(root: string, target: string): string {
  const resolved = resolve(root, target)
  const refuse = () => new CLIError(`Refusing to write outside the project directory: ${target}`, ExitCode.ConfigError)
  if (isOutside(relative(resolve(root), resolved))) throw refuse()
  const realRel = relative(realish(root), realish(dirname(resolved)))
  if (realRel !== '' && isOutside(realRel)) throw refuse()
  try { if (lstatSync(resolved).isSymbolicLink()) throw refuse() } catch (error) {
    if (error instanceof CLIError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw refuse()
  }
  return resolved
}
