import { describe, it, expect } from '@jest/globals'
import { slugify, testFilename, extractUuidFromFilename, stripTitleMetadata, readScriptMetadata, setScriptMetadata } from '../slug.js'

describe('slug utilities', () => {
  it('slugify should normalize titles', () => {
    expect(slugify('Homepage Check')).toBe('homepage-check')
    expect(slugify('  Spaced  Title ')).toBe('spaced-title')
    expect(slugify('A+B/C?')).toBe('abc')
  })

  it('testFilename should include slug, uuid, and extension', () => {
    const id = '019c49bd-e870-73c9-b708-50a24cb4ec63'
    expect(testFilename(id, 'Homepage Check', 'playwright'))
      .toBe(`homepage-check.${id}.pw.ts`)
    expect(testFilename(id, 'Load Test', 'k6'))
      .toBe(`load-test.${id}.k6.ts`)
  })

  it('extractUuidFromFilename should handle legacy and slugged filenames', () => {
    const id = '019c49bd-e870-73c9-b708-50a24cb4ec63'
    expect(extractUuidFromFilename(`${id}.pw.ts`)).toBe(id)
    expect(extractUuidFromFilename(`homepage.${id}.pw.ts`)).toBe(id)
    expect(extractUuidFromFilename(`/tmp/_supercheck_/homepage.${id}.k6.ts`)).toBe(id)
    expect(extractUuidFromFilename(`homepage.${id}.pw.js`)).toBe(id)
    expect(extractUuidFromFilename(`load.${id}.k6.js`)).toBe(id)
    expect(extractUuidFromFilename(`e2e.${id}.spec.ts`)).toBe(id)
  })

  it('stripTitleMetadata should remove injected title lines', () => {
    const script = `// @title Homepage Check\n\nconsole.log('hi')\n`
    expect(stripTitleMetadata(script)).toBe(`console.log('hi')\n`)

    const jsdoc = `/**\n * Test\n * @title My Test\n */\nconsole.log('hi')\n`
    expect(stripTitleMetadata(jsdoc)).toBe(`/**\n * Test\n */\nconsole.log('hi')\n`)
  })

  describe('annotation header confinement', () => {
    it('ignores string literals, mid-script comments and body JSDoc', () => {
      const script = "const a = '@tags smoke'\n// see @tags docs\n/**\n * @priority urgent\n */\nfoo()\n"
      expect(readScriptMetadata(script, 'tags')).toBeUndefined()
      expect(readScriptMetadata(script, 'priority')).toBeUndefined()
      expect(stripTitleMetadata(script)).toBe(script)
      const withTitle = setScriptMetadata(script, 'title', 'T')
      expect(withTitle).toBe(`// @title T\n\n${script}`)
      expect(stripTitleMetadata(withTitle)).toBe(script)
    })

    it('reads and strips a top multi-line JSDoc without touching the closing marker', () => {
      const script = '/**\n * Docs\n * @title X\n * @tags a, b */\nfoo()\n'
      expect(readScriptMetadata(script, 'title')).toBe('X')
      expect(readScriptMetadata(script, 'tags')).toBe('a, b')
      expect(stripTitleMetadata(script)).toBe('/**\n * Docs\n */\nfoo()\n')
    })

    it('does not inject into a single-line JSDoc header', () => {
      const out = setScriptMetadata('/** x */\nfoo()\n', 'title', 'T')
      expect(out).toBe('// @title T\n\n/** x */\nfoo()\n')
      expect(stripTitleMetadata(out)).toBe('/** x */\nfoo()\n')
    })

    it('keeps server-supplied values on one line and inside the comment', () => {
      const out = setScriptMetadata('/**\n * Docs\n */\nfoo()\n', 'tags', 'smoke */ evil()\nsteal()')
      expect(out).toBe('/**\n * @tags smoke * / evil() steal()\n * Docs\n */\nfoo()\n')
      expect(setScriptMetadata('foo()\n', 'priority', 'high\nevil()')).toBe('// @priority high evil()\n\nfoo()\n')
    })

    it('is idempotent across repeated pulls', () => {
      let once = setScriptMetadata('foo()\n', 'title', 'T')
      once = setScriptMetadata(once, 'priority', 'high')
      once = setScriptMetadata(once, 'tags', 'a, b')
      let twice = setScriptMetadata(once, 'title', 'T')
      twice = setScriptMetadata(twice, 'priority', 'high')
      twice = setScriptMetadata(twice, 'tags', 'a, b')
      expect(twice).toBe(once)
      expect(stripTitleMetadata(once)).toBe('foo()\n')
      expect(readScriptMetadata(once, 'tags')).toBe('a, b')
    })

    it('handles CRLF input', () => {
      const script = '// @title X\r\n// @priority high\r\n\r\nfoo()\r\n'
      expect(readScriptMetadata(script, 'priority')).toBe('high')
      expect(stripTitleMetadata(script)).toBe('foo()\r\n')
      expect(setScriptMetadata(script, 'tags', 'a')).toBe('// @title X\r\n// @priority high\r\n// @tags a\r\n\r\nfoo()\r\n')
    })

    it('still parses files written by the old CLI', () => {
      expect(readScriptMetadata('// @title Old\n\nfoo()\n', 'title')).toBe('Old')
      expect(readScriptMetadata('/**\n * @title Old\n */\nfoo()\n', 'title')).toBe('Old')
    })
  })
})
