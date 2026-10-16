import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { runCommand } from '../exec.js'
import { logger } from '../logger.js'
import { setOutputFormat } from '../../output/formatter.js'

afterEach(() => { jest.restoreAllMocks(); setOutputFormat('table') })
describe('local runner machine output', () => {
  it('captures a bounded parseable result and redacts credential URLs without changing the exit code', async () => {
    setOutputFormat('json')
    const output = jest.spyOn(logger, 'output').mockImplementation(() => undefined)
    const code = await runCommand(process.execPath, ['-e', "process.stdout.write('x'.repeat(70000));process.stderr.write('https://user:SENTINEL@example.com/?token=SENTINEL');process.exitCode=7"])
    expect(code).toBe(7)
    expect(output).toHaveBeenCalledTimes(1)
    const event = JSON.parse(output.mock.calls[0][0])
    expect(event).toMatchObject({ event: 'local.result', exitCode: 7, truncated: true })
    expect(event.stdout.length).toBe(65536)
    expect(event.stderr).not.toContain('SENTINEL')
  })
  it('preserves the native structured runner report as data', async () => {
    setOutputFormat('json')
    const output = jest.spyOn(logger, 'output').mockImplementation(() => undefined)
    expect(await runCommand(process.execPath, ['-e', 'console.log(JSON.stringify({stats:{expected:1,unexpected:0}}))'])).toBe(0)
    expect(JSON.parse(output.mock.calls[0][0]).result).toEqual({ stats: { expected: 1, unexpected: 0 } })
  })
  it('parses a structured report larger than the text capture limit', async () => {
    setOutputFormat('json')
    const output = jest.spyOn(logger, 'output').mockImplementation(() => undefined)
    expect(await runCommand(process.execPath, ['-e', "console.log(JSON.stringify({stats:{expected:1},pad:'p'.repeat(200000)}))"])).toBe(0)
    const event = JSON.parse(output.mock.calls[0][0])
    expect(event.result.stats).toEqual({ expected: 1 })
    expect(event.truncated).toBe(false)
  })
  it('keeps the tail of oversized text output where failure summaries appear', async () => {
    setOutputFormat('json')
    const output = jest.spyOn(logger, 'output').mockImplementation(() => undefined)
    await runCommand(process.execPath, ['-e', "process.stdout.write('a'.repeat(80000)+'FINAL-SUMMARY')"])
    const event = JSON.parse(output.mock.calls[0][0])
    expect(event.stdout.endsWith('FINAL-SUMMARY')).toBe(true)
    expect(event.truncated).toBe(true)
  })
  it('reports truncation of oversized stderr even when the report parses', async () => {
    setOutputFormat('json')
    const output = jest.spyOn(logger, 'output').mockImplementation(() => undefined)
    await runCommand(process.execPath, ['-e', "process.stderr.write('e'.repeat(80000));console.log(JSON.stringify({ok:true}))"])
    const event = JSON.parse(output.mock.calls[0][0])
    expect(event.result).toEqual({ ok: true })
    expect(event.truncated).toBe(true)
  })
})
