import { isAbsolute, relative, resolve } from 'node:path'
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Resource IDs become file names; only canonical UUIDs are accepted so a server cannot smuggle path segments. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** Resolve `target` against `root` and refuse anything that lands outside it (traversal, absolute paths). */
export function resolveWithin(root: string, target: string): string {
  const resolved = resolve(root, target)
  const rel = relative(resolve(root), resolved)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new CLIError(`Refusing to write outside the project directory: ${target}`, ExitCode.ConfigError)
  }
  return resolved
}
