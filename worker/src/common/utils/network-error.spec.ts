import { isDnsError, isTimeoutError, networkErrorCodes } from './network-error';

const withCode = (message: string, code: string) =>
  Object.assign(new Error(message), { code });

describe('network error classification', () => {
  it.each([
    withCode('connect ETIMEDOUT 1.2.3.4:443', 'ETIMEDOUT'),
    withCode('', 'ETIMEDOUT'),
    new Error('Connection Timeout after 5000ms'),
    new Error('request timed out'),
    new AggregateError([withCode('', 'ETIMEDOUT')]),
    Object.assign(new Error('fetch failed'), {
      cause: withCode('', 'ETIMEDOUT'),
    }),
  ])('recognises a timeout: %#', (error) => {
    expect(isTimeoutError(error)).toBe(true);
  });

  it.each([
    withCode('refused', 'ECONNREFUSED'),
    new Error('boom'),
    'plain failure',
    undefined,
  ])('does not call %# a timeout', (error) => {
    expect(isTimeoutError(error)).toBe(false);
  });

  it('does not mistake a hostname containing "timeout" for a timeout', () => {
    const error = withCode(
      'getaddrinfo ENOTFOUND timeout.example.com',
      'ENOTFOUND',
    );
    expect(isTimeoutError(error)).toBe(false);
    expect(isDnsError(error)).toBe(true);
  });

  it('does not call a refused-and-timed-out aggregate a timeout', () => {
    expect(
      isTimeoutError(
        new AggregateError([
          withCode('', 'ECONNREFUSED'),
          withCode('', 'ETIMEDOUT'),
        ]),
      ),
    ).toBe(false);
  });

  it.each(['ENOTFOUND', 'EAI_AGAIN'])('recognises DNS code %s', (code) => {
    expect(isDnsError(withCode('lookup failed', code))).toBe(true);
    expect(isDnsError(new AggregateError([withCode('x', code)]))).toBe(true);
  });

  it('collects codes from cause and aggregate members', () => {
    const error = Object.assign(new AggregateError([withCode('a', 'EA')]), {
      cause: withCode('b', 'EB'),
    });
    expect(networkErrorCodes(error).sort()).toEqual(['EA', 'EB']);
    expect(isDnsError(withCode('x', 'ECONNRESET'))).toBe(false);
  });
});
