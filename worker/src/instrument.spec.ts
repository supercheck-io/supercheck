export {};

const loaded = jest.fn();
const initSentry = jest.fn(() => true);
jest.mock('./common/sentry', () => {
  loaded();
  return { initSentry };
});

const DSN = 'https://abc@o1.ingest.sentry.io/1';

function preload(env: Record<string, string>) {
  const original = { ...process.env };
  Object.assign(process.env, env);
  try {
    jest.isolateModules(() => {
      require('./instrument');
    });
  } finally {
    process.env = original;
  }
}

describe('instrument preload', () => {
  beforeEach(() => jest.clearAllMocks());

  it('never loads the SDK when self-hosted, without a DSN, or for private agents', () => {
    preload({ SELF_HOSTED: 'true', SENTRY_DSN: DSN });
    preload({ SELF_HOSTED: 'false', SENTRY_DSN: '' });
    preload({
      SELF_HOSTED: 'false',
      SENTRY_DSN: DSN,
      SUPERCHECK_RUNTIME_MODE: 'private-agent',
    });
    expect(loaded).not.toHaveBeenCalled();
  });

  it('inits on cloud with a DSN', () => {
    preload({ SELF_HOSTED: 'false', SENTRY_DSN: DSN });
    expect(initSentry).toHaveBeenCalledTimes(1);
  });
});
