import { describe, it, expect } from '@jest/globals'
import { slugify, testFilename, extractUuidFromFilename, stripTitleMetadata } from '../slug.js'

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
  })

  it('stripTitleMetadata should remove injected title lines', () => {
    const script = `// @title Homepage Check\n\nconsole.log('hi')\n`
    expect(stripTitleMetadata(script)).toBe(`console.log('hi')\n`)

    const jsdoc = `/**\n * Test\n * @title My Test\n */\nconsole.log('hi')\n`
    expect(stripTitleMetadata(jsdoc)).toBe(`/**\n * Test\n */\nconsole.log('hi')\n`)
  })
})
