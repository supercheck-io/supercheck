import { getSSLConfig } from './db-ssl';

describe('getSSLConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SELF_HOSTED;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns undefined when SELF_HOSTED=true', () => {
    process.env.SELF_HOSTED = 'true';
    expect(getSSLConfig()).toBeUndefined();
  });

  it('returns verify-full when SELF_HOSTED=false', () => {
    process.env.SELF_HOSTED = 'false';
    expect(getSSLConfig()).toBe('verify-full');
  });

  it('returns verify-full when SELF_HOSTED is not set', () => {
    expect(getSSLConfig()).toBe('verify-full');
  });

  it('treats SELF_HOSTED as case-insensitive', () => {
    process.env.SELF_HOSTED = 'TRUE';
    expect(getSSLConfig()).toBeUndefined();
  });
  it.each(['1', ' true ', ' TRUE '])(
    'recognizes self-hosted value %s consistently',
    (value) => {
      process.env.SELF_HOSTED = value;
      expect(getSSLConfig()).toBeUndefined();
    },
  );
});
