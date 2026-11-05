import { describe, expect, it } from '@jest/globals'
import { EventEmitter } from 'node:events'
import { ignoreBrokenPipe } from '../broken-pipe.js'

function fakeStream() {
  const stream = new EventEmitter() as EventEmitter & { write: (chunk: string) => boolean }
  stream.write = () => false
  return stream
}

describe('ignoreBrokenPipe', () => {
  it('turns further writes into no-ops after EPIPE', () => {
    const stream = fakeStream()
    ignoreBrokenPipe(stream as never)
    stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
    expect(stream.write('more')).toBe(true)
  })
  it('does not hide other stream errors', () => {
    const stream = fakeStream()
    ignoreBrokenPipe(stream as never)
    expect(() => stream.emit('error', Object.assign(new Error('boom'), { code: 'EIO' }))).toThrow('boom')
  })
})
