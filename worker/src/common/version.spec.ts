import { getServiceVersion } from './version';

const ORIGINAL_ENV = { ...process.env };

describe('getServiceVersion', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('prefers the injected release version over the npm package version', () => {
    process.env.SUPERCHECK_VERSION = '1.3.7-rc.1';
    process.env.npm_package_version = '1.3.6';

    expect(getServiceVersion()).toBe('1.3.7-rc.1');
  });

  it('falls back to the npm package version for local runs', () => {
    delete process.env.SUPERCHECK_VERSION;
    process.env.npm_package_version = '1.3.6';

    expect(getServiceVersion()).toBe('1.3.6');
  });

  it('returns a neutral fallback instead of a hardcoded version', () => {
    delete process.env.SUPERCHECK_VERSION;
    delete process.env.npm_package_version;

    expect(getServiceVersion()).toBe('unknown');
  });

  it('ignores blank or whitespace-only values', () => {
    process.env.SUPERCHECK_VERSION = '   ';
    delete process.env.npm_package_version;

    expect(getServiceVersion()).toBe('unknown');
  });
});
