import { describe, expect, it } from '@jest/globals'
const { flattenSchema, schemaCommand } = await import('../skills.js')

describe('schema config human output', () => {
  it('flattens the config schema to field paths quickly', () => {
    const lines: string[] = []
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string) => { lines.push(String(chunk)); return true }) as typeof process.stdout.write
    try { schemaCommand.parse(['node', 'schema', 'config']) } finally { process.stdout.write = write }
    const text = lines.join('')
    expect(text).toContain('project')
    expect(text.length).toBeGreaterThan(200)
  }, 8000)
  it('flattens optional and array fields', () => {
    const rows = flattenSchema({ type: 'object', properties: { a: { optional: true, value: { type: 'string' } }, b: { type: 'array', items: { type: 'number' } } } })
    expect(rows).toEqual([{ field: 'a', type: 'string (optional)' }, { field: 'b[]', type: 'number' }])
  })
})
