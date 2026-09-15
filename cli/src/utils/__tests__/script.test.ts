import { describe, expect, it } from '@jest/globals'
import {
  decodeStoredTestScript,
  encodeStoredTestScript,
  sanitizeTestScript,
} from '../script.js'

describe('script encoding', () => {
  it('strips appended sourcemap comments and binary bytes before deploy', () => {
    const source = [
      "import { test } from '@playwright/test';",
      "test('ok', async () => {});",
      '//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbXX0=',
      '\u0000\uFFFD\u0001binary',
    ].join('\n')

    expect(sanitizeTestScript(source)).toBe(
      "import { test } from '@playwright/test';\ntest('ok', async () => {});\n",
    )
  })

  it('encodes UTF-8 source as Base64 for the API', () => {
    const source = "import { test } from '@playwright/test';\ntest('ok', async () => {});\n"
    const encoded = encodeStoredTestScript(source)
    expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(decodeStoredTestScript(encoded)).toBe(source)
  })

  it('does not treat raw TypeScript as Base64', () => {
    const source = "import { test } from '@playwright/test';\ntest('ok', async () => {});\n"
    expect(decodeStoredTestScript(source)).toBe(source)
  })
})
