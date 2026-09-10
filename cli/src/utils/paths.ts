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