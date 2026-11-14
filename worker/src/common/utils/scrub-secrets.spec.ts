import { scrubSecrets, secretEchoForms } from './scrub-secrets';

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

  it('masks a secret cut off by an earlier truncation', () => {
    expect(
      scrubSecrets({ m: 'x'.repeat(5) + 'sk-echoed-' }, ['sk-echoed-key']),
    ).toEqual({ m: 'xxxxx***' });
    expect(scrubSecrets({ m: 'model-sk' }, ['sk-echoed-key'])).toEqual({
      m: 'model-sk',
    });
  });

  it('covers URL-encoded, JSON-escaped and basic-auth base64 echoes', () => {
    const forms = secretEchoForms('p@ss"/w', 'me');
    const b64 = Buffer.from('me:p@ss"/w').toString('base64');
    const out = scrubSecrets(
      {
        a: `q=${encodeURIComponent('p@ss"/w')}`,
        b: '{"k":"p@ss\\"/w"}',
        c: `Basic ${b64}`,
      },
      forms,
    );
    expect(JSON.stringify(out)).not.toMatch(/p@ss|p%40ss/);
    expect(out.c).toBe('Basic ***');
  });

  it('covers lowercase percent, form, HTML-entity, slash-escaped JSON and base64 echoes', () => {
    const secret = 'a/b c&"d';
    const echoes = [
      'a%2fb%20c%26%22d',
      'a%2Fb+c%26%22d',
      'a/b c&amp;&quot;d',
      'a\\/b c&\\"d',
      Buffer.from(secret).toString('base64'),
    ];
    const out = scrubSecrets({ e: echoes }, secretEchoForms(secret));
    expect(out.e).toEqual(echoes.map(() => '***'));
  });

  it('does not scrub secrets shorter than 4 characters', () => {
    expect(scrubSecrets({ m: 'a cat' }, ['a'])).toEqual({ m: 'a cat' });
  });

  it('ignores empty secrets and leaves values without secrets unchanged', () => {
    const details = { errorMessage: 'abc' };
    expect(scrubSecrets(details, [''])).toBe(details);
    expect(scrubSecrets(details, ['zzz'])).toEqual(details);
  });
});
