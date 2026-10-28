import { expect, test } from '@playwright/test';
import { autoConnect, canAutoConnect, clearConfig, getConfig, saveConfig } from '../../examples/recorder-crx/src/supercheck/config';

type Area = Record<string, unknown>;

function fakeArea(data: Area) {
  return {
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    set: async (values: Area) => { Object.assign(data, values); },
    remove: async (key: string) => { delete data[key]; },
  };
}

async function withStorage(sync: Area, local: Area, run: () => Promise<void>) {
  const original = globalThis.chrome;
  globalThis.chrome = { storage: { sync: fakeArea(sync), local: fakeArea(local) } } as unknown as typeof chrome;
  try {
    await run();
  } finally {
    globalThis.chrome = original;
  }
}

const key = { instanceUrl: 'https://app.supercheck.io', apiKey: 'ext-secret', autoConnected: true };

test('migrates a synced credential to local storage once and removes the synced copy', async () => {
  const sync: Area = { supercheckConfig: key };
  const local: Area = {};
  await withStorage(sync, local, async () => {
    expect((await getConfig()).apiKey).toBe('ext-secret');
    expect(local.supercheckConfig).toEqual(key);
    expect(sync.supercheckConfig).toBeUndefined();
  });
});

test('keeps the credential out of synced storage when saving', async () => {
  const sync: Area = {};
  const local: Area = {};
  await withStorage(sync, local, async () => {
    await saveConfig(key);
    expect(sync.supercheckConfig).toBeUndefined();
    expect((local.supercheckConfig as { apiKey: string }).apiKey).toBe('ext-secret');
  });
});

test('disconnect clears both the local and any leftover synced copy', async () => {
  const sync: Area = { supercheckConfig: key };
  const local: Area = { supercheckConfig: key };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  try {
    await withStorage(sync, local, async () => {
      await clearConfig();
      expect(local.supercheckConfig).toBeUndefined();
      expect(sync.supercheckConfig).toBeUndefined();
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const payload = {
  instanceUrl: 'https://app.supercheck.io',
  apiKey: 'ext-new',
  userId: 'u1',
  userEmail: 'a@example.test',
};

test('auto-connect never silently replaces a saved self-hosted instance', async () => {
  const local: Area = { supercheckConfig: { instanceUrl: 'https://sc.corp.example' } };
  await withStorage({}, local, async () => {
    await expect(autoConnect(payload)).rejects.toThrow(/sc\.corp\.example/);
    expect(local.supercheckConfig).toEqual({ instanceUrl: 'https://sc.corp.example' });
  });
});

test('auto-connect from the saved instance or a default config stores the credential locally', async () => {
  const local: Area = { supercheckConfig: { instanceUrl: 'https://sc.corp.example' } };
  await withStorage({}, local, async () => {
    await autoConnect({ ...payload, instanceUrl: 'https://sc.corp.example' });
    expect(local.supercheckConfig).toMatchObject({ instanceUrl: 'https://sc.corp.example', apiKey: 'ext-new', autoConnected: true });
  });
  const fresh: Area = {};
  await withStorage({}, fresh, async () => {
    await autoConnect(payload);
    expect(fresh.supercheckConfig).toMatchObject({ apiKey: 'ext-new', autoConnected: true });
  });
});

test('only offers auto-connect to a page the saved instance allows', () => {
  expect(canAutoConnect('https://app.supercheck.io', 'https://demo.supercheck.dev')).toBe(true);
  expect(canAutoConnect('https://sc.corp.example', 'https://sc.corp.example')).toBe(true);
  expect(canAutoConnect('https://sc.corp.example', 'https://app.supercheck.io')).toBe(false);
});
