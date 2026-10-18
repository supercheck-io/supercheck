import { expect, test } from '@playwright/test';
import { clearConfig } from '../../examples/recorder-crx/src/supercheck/config';

test('revokes the held key before removing local recorder credentials', async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  let removed = false;
  try {
    globalThis.chrome = { storage: { sync: {
      get: async () => ({ supercheckConfig: { instanceUrl: 'https://app.example.test', apiKey: 'ext-test' } }),
      remove: async () => { removed = true; },
    } } } as unknown as typeof chrome;
    globalThis.fetch = async (url, init) => {
      expect(removed).toBe(false);
      expect(url).toBe('https://app.example.test/api/extension/auth');
      expect(init?.method).toBe('DELETE');
      expect(init?.headers).toEqual({ 'x-api-key': 'ext-test' });
      return new Response(null, { status: 200 });
    };
    await clearConfig();
    expect(removed).toBe(true);
    removed = false;
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await expect(clearConfig()).rejects.toThrow('Could not revoke');
    expect(removed).toBe(false);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});
