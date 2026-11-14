import { scrubSecrets } from './scrub-secrets';

describe('scrubSecrets', () => {
  it('replaces the secret in every nested string, including header values and metadata', () => {
    const details = {
      statusText: 'OK sk-1',
      responseHeaders: { 'x-debug': 'key=sk-1' },
      ai: { servedModel: 'sk-1', totalMs: 5 },
      list: ['a sk-1 b'],
    };
    expect(scrubSecrets(details, ['sk-1'])).toEqual({
      statusText: 'OK ***',
      responseHeaders: { 'x-debug': 'key=***' },
      ai: { servedModel: '***', totalMs: 5 },
      list: ['a *** b'],
    });
  });

  it('ignores empty secrets and leaves values without secrets unchanged', () => {
    const details = { errorMessage: 'abc' };
    expect(scrubSecrets(details, [''])).toBe(details);
    expect(scrubSecrets(details, ['zzz'])).toEqual(details);
  });
});
