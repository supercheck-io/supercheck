import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
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
const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
beforeEach(() => { Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true }) })
afterEach(() => { if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor); else Reflect.deleteProperty(process.stdin, 'isTTY') })
describe('confirmation EOF', () => {
  it('declines EOF even when the prompt defaults to yes', async () => {
    input = null
    await expect(confirmPrompt('Delete?', { default: true })).rejects.toThrow('ABORTED')
  })
  it('keeps explicit and default answers', async () => {
    input = 'yes'; await expect(confirmPrompt('Delete?')).resolves.toBeUndefined()
    input = ''; await expect(confirmPrompt('Delete?', { default: true })).resolves.toBeUndefined()
    input = 'no'; await expect(confirmPrompt('Delete?')).rejects.toThrow('ABORTED')
  })
})
