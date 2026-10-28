import { expect, test } from '@playwright/test';
import { addConfigChangeListener, clearConfig, type SupercheckConfig } from '../../examples/recorder-crx/src/supercheck/config';

type FetchImpl = typeof fetch;

test('notifies config changes and rejects missing or malformed stored values', () => {
  const originalChrome = globalThis.chrome;
  type ChangeListener = Parameters<typeof chrome.storage.local.onChanged.addListener>[0];
  let handler: ChangeListener | undefined;
  let removed: ChangeListener | undefined;
  const values: (SupercheckConfig | null)[] = [];
  try {
    globalThis.chrome = { storage: { local: { onChanged: {
      addListener: (listener: ChangeListener) => { handler = listener; },
      removeListener: (listener: ChangeListener) => { removed = listener; },
    } } } } as unknown as typeof chrome;
    const unsubscribe = addConfigChangeListener(value => values.push(value));
    const config = { instanceUrl: 'https://app.example.test', apiKey: 'ext-test' };
    handler!({ unrelated: { newValue: config } });
    expect(values).toEqual([]);
    handler!({ supercheckConfig: { newValue: config } });
    handler!({ supercheckConfig: {} });
    handler!({ supercheckConfig: { newValue: { instanceUrl: 42 } } });
    expect(values).toEqual([config, null, null]);
    unsubscribe();
    expect(removed).toBe(handler);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

async function withConfiguredStorage(
  fetchImpl: FetchImpl,
  run: (state: { removed: () => boolean }) => Promise<void>,
) {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  let removed = false;
  try {
    const area = {
      get: async () => ({ supercheckConfig: { instanceUrl: 'https://app.example.test', apiKey: 'ext-test' } }),
      remove: async () => { removed = true; },
    };
    globalThis.chrome = { storage: { local: area, sync: area } } as unknown as typeof chrome;
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
