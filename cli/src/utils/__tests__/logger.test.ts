import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { logger, setLogLevel, setQuietMode } from '../logger.js'
import { setRevealSecrets } from '../redact.js'

afterEach(() => { jest.restoreAllMocks(); setQuietMode(false); setLogLevel('info'); setRevealSecrets(false) })
describe('diagnostic redaction', () => {
  it('redacts diagnostic messages and structured arguments even with debug enabled', () => {
    setLogLevel('debug')
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const level of ['debug', 'info', 'success', 'warn', 'error'] as const) {
      logger[level]('https://user:SENTINEL@example.com/?token=SENTINEL', { password: 'SENTINEL' })
    }
    expect(error).toHaveBeenCalledTimes(5)
    expect(JSON.stringify(error.mock.calls)).not.toContain('SENTINEL')
    setRevealSecrets(true)
    logger.debug('https://user:SENTINEL@example.com', { password: 'SENTINEL' })
    expect(JSON.stringify(error.mock.calls.at(-1))).toContain('SENTINEL')
  })
})
