import { describe, expect, it } from '@jest/globals'
import { requirementDefinitionSchema, statusPageDefinitionSchema } from '../schema.js'

describe('status page schema', () => {
  it('leaves absent notification flags undefined (no defaults)', () => {
    const parsed = statusPageDefinitionSchema.parse({ name: 'A', notifications: { allowRssFeed: false } })
    expect(parsed.notifications).toEqual({ allowRssFeed: false })
  })

  it('accepts all branding keys as #RRGGBB and rejects other formats', () => {
    const branding = {
      bodyBackgroundColor: '#ffffff', fontColor: '#333333', lightFontColor: '#666666', greens: '#2ecc71', yellows: '#f1c40f', oranges: '#e67e22',
      blues: '#3498db', reds: '#e74c3c', borderColor: '#ecf0f1', graphColor: '#3498db', linkColor: '#3498db', noData: '#bdc3c7',
    }
    expect(statusPageDefinitionSchema.parse({ name: 'A', branding }).branding).toEqual(branding)
    expect(() => statusPageDefinitionSchema.parse({ name: 'A', branding: { reds: 'red' } })).toThrow()
    expect(() => statusPageDefinitionSchema.parse({ name: 'A', branding: { reds: '#fff' } })).toThrow()
    expect(() => statusPageDefinitionSchema.parse({ name: 'A', branding: { unknown: '#ffffff' } })).toThrow()
  })

  it('accepts timezone, customDomain and subdomain', () => {
    expect(statusPageDefinitionSchema.parse({ name: 'A', timezone: 'UTC', customDomain: 'status.example.com', subdomain: 'abc' })).toMatchObject({ timezone: 'UTC', customDomain: 'status.example.com' })
  })
})

describe('requirement schema', () => {
  it('validates fields strictly', () => {
    expect(requirementDefinitionSchema.parse({ title: 'R', priority: 'low', tags: ['a'], tests: ['x'] })).toBeTruthy()
    expect(() => requirementDefinitionSchema.parse({ title: '' })).toThrow()
    expect(() => requirementDefinitionSchema.parse({ title: 'R', priority: 'urgent' })).toThrow()
    expect(() => requirementDefinitionSchema.parse({ title: 'R', externalUrl: 'nope' })).toThrow()
    expect(() => requirementDefinitionSchema.parse({ title: 'R', extra: 1 })).toThrow()
  })
})
