import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { createSpinner, startSpinner, withSpinner } from '../spinner.js'
import { setOutputFormat } from '../../output/formatter.js'

const originalStderrTty = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY')
const originalStdinTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
const originalColumns = Object.getOwnPropertyDescriptor(process.stderr, 'columns')
afterEach(() => {
  jest.restoreAllMocks(); setOutputFormat('table')
  for (const [stream, key, descriptor] of [
    [process.stderr, 'isTTY', originalStderrTty],
    [process.stdin, 'isTTY', originalStdinTty],
    [process.stderr, 'columns', originalColumns],
  ] as const) {
    if (descriptor) Object.defineProperty(stream, key, descriptor)
    else Reflect.deleteProperty(stream, key)
  }
})

describe('terminal progress', () => {
  it.each([0, undefined])('stays silent in an unsized PTY (%s columns)', async (columns) => {
    Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(process.stderr, 'columns', { configurable: true, value: columns })
    const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const spinner = createSpinner('waiting').start()
    spinner.stop()
    const manual = startSpinner('waiting')
    manual.update('done'); manual.succeed('done'); manual.stop()
    expect(await withSpinner('waiting', async () => 42)).toBe(42)
    expect(write).not.toHaveBeenCalled()
  })
})
