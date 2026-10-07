import { describe, expect, it, jest } from '@jest/globals'
import { EventEmitter } from 'node:events'
let input: string | null = null
jest.unstable_mockModule('node:readline', () => ({
  createInterface: () => {
    const events = new EventEmitter()
    return Object.assign(events, {
      question(_message: string, callback: (answer: string) => void) {
        queueMicrotask(() => { if (input === null) events.emit('close'); else callback(input) })
      },
      close() { events.emit('close') },
    })
  },
}))
const { confirmPrompt } = await import('../prompt.js')
describe('confirmation EOF', () => {
  it('declines EOF even when the prompt defaults to yes', async () => {
    input = null
    expect(await confirmPrompt('Delete?', { default: true })).toBe(false)
  })
  it('keeps explicit and default answers', async () => {
    input = 'yes'; expect(await confirmPrompt('Delete?')).toBe(true)
    input = ''; expect(await confirmPrompt('Delete?', { default: true })).toBe(true)
    input = 'no'; expect(await confirmPrompt('Delete?')).toBe(false)
  })
})
