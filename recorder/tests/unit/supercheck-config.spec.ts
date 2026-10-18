import { expect, test } from '@playwright/test';
import { clearConfig } from '../../examples/recorder-crx/src/supercheck/config';

type FetchImpl = typeof fetch;

async function withConfiguredStorage(
  fetchImpl: FetchImpl,
  run: (state: { removed: () => boolean }) => Promise<void>,
) {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  let removed = false;
  try {
    globalThis.chrome = { storage: { sync: {
      get: async () => ({ supercheckConfig: { instanceUrl: 'https://app.example.test', apiKey: 'ext-test' } }),
      remove: async () => { removed = true; },
    } } } as unknown as typeof chrome;
    globalThis.fetch = fetchImpl;
    await run({ removed: () => removed });
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
}

test('revokes the held key before removing local recorder credentials', async () => {
  let removedAtRequest: boolean | undefined;
  await withConfiguredStorage(
    (async (url, init) => {
      expect(url).toBe('https://app.example.test/api/extension/auth');
      expect(init?.method).toBe('DELETE');
      expect(init?.headers).toEqual({ 'x-api-key': 'ext-test' });
      removedAtRequest = false;
      return new Response(null, { status: 200 });
    }) as FetchImpl,
    async ({ removed }) => {
      await expect(clearConfig()).resolves.toEqual({ revoked: true });
      expect(removedAtRequest).toBe(false);
      expect(removed()).toBe(true);
    },
  );
});

test('treats an already-invalid key as revoked', async () => {
  await withConfiguredStorage(
    (async () => new Response(null, { status: 401 })) as FetchImpl,
    async ({ removed }) => {
      await expect(clearConfig()).resolves.toEqual({ revoked: true });
      expect(removed()).toBe(true);
    },
  );
});

test('still removes local credentials when the server cannot revoke the key', async () => {
  await withConfiguredStorage(
    (async () => new Response(null, { status: 503 })) as FetchImpl,
    async ({ removed }) => {
      await expect(clearConfig()).resolves.toEqual({ revoked: false });
      expect(removed()).toBe(true);
    },
  );
});

test('still removes local credentials when the instance is unreachable', async () => {
  await withConfiguredStorage(
    (async () => { throw new TypeError('fetch failed'); }) as FetchImpl,
    async ({ removed }) => {
      await expect(clearConfig()).resolves.toEqual({ revoked: false });
      expect(removed()).toBe(true);
    },
  );
});
