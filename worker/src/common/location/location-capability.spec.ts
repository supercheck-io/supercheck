import {
  isMissingCapabilityColumnError,
  CAPABILITY_CACHE_TTL_MS,
  clearLocationCapabilityCache,
  locationSupportsWorkload,
} from './location-capability';

describe('locationSupportsWorkload', () => {
  beforeEach(() => {
    clearLocationCapabilityCache();
    jest.useRealTimers();
  });

  const dbWith = (execute: jest.Mock) => ({ db: { execute } });

  it('returns the browser and k6 flags', async () => {
    const execute = jest
      .fn()
      .mockResolvedValue([{ supports_browser: true, supports_k6: false }]);
    const db = dbWith(execute);
    await expect(
      locationSupportsWorkload(db, 'eu-central', 'browser'),
    ).resolves.toBe(true);
    await expect(
      locationSupportsWorkload(db, 'eu-central', 'k6'),
    ).resolves.toBe(false);
  });

  it('treats a missing location as unsupported', async () => {
    const db = dbWith(jest.fn().mockResolvedValue([]));
    await expect(locationSupportsWorkload(db, 'gone', 'browser')).resolves.toBe(
      false,
    );
  });

  it('throws on DB errors so unknown capability is never allowed', async () => {
    const db = dbWith(jest.fn().mockRejectedValue(new Error('db down')));
    await expect(
      locationSupportsWorkload(db, 'eu-central', 'browser'),
    ).rejects.toThrow('db down');
  });

  it('caches within the TTL and refreshes after it (bounded propagation window)', async () => {
    jest.useFakeTimers();
    const execute = jest
      .fn()
      .mockResolvedValueOnce([{ supports_browser: true, supports_k6: true }])
      .mockResolvedValueOnce([{ supports_browser: false, supports_k6: true }]);
    const db = dbWith(execute);
    await expect(
      locationSupportsWorkload(db, 'us-east', 'browser'),
    ).resolves.toBe(true);
    await expect(
      locationSupportsWorkload(db, 'us-east', 'browser'),
    ).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(CAPABILITY_CACHE_TTL_MS + 1);
    await expect(
      locationSupportsWorkload(db, 'us-east', 'browser'),
    ).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('treats a missing capability column (worker newer than migration) as supported', async () => {
    const missing = Object.assign(
      new Error('column "supports_browser" does not exist'),
      { code: '42703' },
    );
    const wrapped = new Error('Failed query', { cause: missing });
    const db = dbWith(jest.fn().mockRejectedValue(wrapped));
    await expect(
      locationSupportsWorkload(db, 'local', 'browser'),
    ).resolves.toBe(true);
    await expect(locationSupportsWorkload(db, 'local', 'k6')).resolves.toBe(
      true,
    );
  });

  it('does not treat other undefined-column errors or generic failures as supported', async () => {
    expect(
      isMissingCapabilityColumnError(
        Object.assign(new Error('column "foo" does not exist'), {
          code: '42703',
        }),
      ),
    ).toBe(false);
    expect(isMissingCapabilityColumnError(new Error('db down'))).toBe(false);
  });
});
