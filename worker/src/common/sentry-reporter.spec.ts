const loaded = jest.fn();
const reportJobFailure = jest.fn();
const initSentry = jest.fn(() => true);
const closeSentry = jest.fn().mockResolvedValue(undefined);
jest.mock('./sentry', () => {
  loaded();
  return { reportJobFailure, initSentry, closeSentry };
});

const DSN = 'https://abc@o1.ingest.sentry.io/1';

function load() {
  let mod!: typeof import('./sentry-reporter');
  jest.isolateModules(() => {
    mod = require('./sentry-reporter');
  });
  return mod;
}

describe('sentry-reporter', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    jest.clearAllMocks();
  });

  it('never loads the SDK module when disabled or self-hosted', async () => {
    const m = load();
    expect(m.initSentry()).toBe(false);
    m.captureJobFailure({ id: '1' }, new Error('x'));
    process.env.SENTRY_DSN = DSN;
    process.env.SELF_HOSTED = 'true';
    expect(m.initSentry()).toBe(false);
    m.captureJobFailure({ id: '1' }, new Error('x'));
    await new m.SentryShutdown().onApplicationShutdown();
    expect(loaded).not.toHaveBeenCalled();
  });

  it('loads and inits the SDK module on cloud with a DSN', async () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SELF_HOSTED = 'false';
    const m = load();
    expect(m.initSentry()).toBe(true);
    expect(loaded).toHaveBeenCalledTimes(1);
    await new m.SentryShutdown().onApplicationShutdown();
    expect(closeSentry).toHaveBeenCalledWith(2000);
  });

  it('reports only the final failed attempt', () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SELF_HOSTED = 'false';
    const m = load();
    const err = new Error('boom');
    m.captureJobFailure({ attemptsMade: 1, opts: { attempts: 3 } }, err);
    m.captureJobFailure({ attemptsMade: 2, opts: { attempts: 3 } }, err);
    expect(reportJobFailure).not.toHaveBeenCalled();
    m.captureJobFailure({ attemptsMade: 3, opts: { attempts: 3 } }, err);
    m.captureJobFailure({ attemptsMade: 1 }, err);
    expect(reportJobFailure).toHaveBeenCalledTimes(2);
  });

  it('never throws', () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SELF_HOSTED = 'false';
    reportJobFailure.mockImplementationOnce(() => {
      throw new Error('sdk down');
    });
    const m = load();
    expect(() =>
      m.captureJobFailure({ attemptsMade: 1 }, new Error('x')),
    ).not.toThrow();
  });
});
