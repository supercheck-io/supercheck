jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/node';
import {
  captureJobFailure,
  getSentryOptions,
  initSentry,
  scrubEvent,
  scrubString,
} from './sentry';

const DSN = 'https://abc@o1.ingest.sentry.io/1';

describe('enable gate', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    jest.clearAllMocks();
  });

  it('is off without a DSN', () => {
    expect(getSentryOptions({}, false)).toBeNull();
    expect(getSentryOptions({ SENTRY_DSN: '  ' }, false)).toBeNull();
  });

  it('is off when self-hosted even with a DSN', () => {
    expect(getSentryOptions({ SENTRY_DSN: DSN }, true)).toBeNull();
  });

  it('initSentry does not call Sentry.init when gated off', () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SELF_HOSTED = 'true';
    expect(initSentry()).toBe(false);
    delete process.env.SENTRY_DSN;
    process.env.SELF_HOSTED = 'false';
    expect(initSentry()).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('inits privately on cloud with a DSN', () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SELF_HOSTED = 'false';
    process.env.SENTRY_RELEASE = '1.2.3';
    expect(initSentry()).toBe(true);
    const opts = (Sentry.init as jest.Mock).mock.calls[0][0];
    expect(opts.release).toBe('1.2.3');
    expect(opts.tracesSampleRate).toBeUndefined();
    expect(opts.dataCollection.httpBodies).toEqual([]);
    expect(opts.beforeBreadcrumb({ message: 'x' })).toBeNull();
    const names = opts
      .integrations([
        { name: 'Console' },
        { name: 'RequestData' },
        { name: 'Dedupe' },
      ])
      .map((i: { name: string }) => i.name);
    expect(names).toEqual(['Dedupe']);
  });
});

describe('scrubString', () => {
  it.each([
    ['Bearer abc.def-123', 'abc.def'],
    ['password=hunter2', 'hunter2'],
    ['api_key: sk_live_abc', 'sk_live_abc'],
    ['mail bob@example.com now', 'bob@example.com'],
    ['postgres://u:pw@db:5432/x', 'pw@db'],
    ['GET https://a.test/p?token=abc&x=1 failed', 'token=abc'],
  ])('redacts %s', (input, leaked) => {
    expect(scrubString(input)).not.toContain(leaked);
  });

  it('caps length', () => {
    expect(scrubString('a b '.repeat(500)).length).toBeLessThanOrEqual(503);
  });
});

describe('scrubEvent', () => {
  it('drops request, extra, breadcrumbs and unsafe context, keeps allowed fields', () => {
    const event = scrubEvent<Sentry.ErrorEvent>({
      type: undefined,
      request: { url: 'https://x.test/a?b=1', headers: { cookie: 's' } },
      extra: { script: 'secret' },
      breadcrumbs: [{ message: 'log' }],
      server_name: 'host',
      user: { id: 'u1', email: 'a@b.co', ip_address: '1.1.1.1' },
      contexts: {
        runtime: { name: 'node' },
        os: { name: 'linux' },
        app: { x: 1 },
      },
      tags: { organizationId: 'o1', testName: 'My test', runId: 'r1' },
      exception: {
        values: [
          {
            value: 'failed for a@b.co with password=abc',
            stacktrace: {
              frames: [{ filename: 'f', vars: { a: 1 }, context_line: 'x' }],
            },
          },
        ],
      },
    }) as unknown as Record<string, any>;
    expect(event.request).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.breadcrumbs).toBeUndefined();
    expect(event.server_name).toBeUndefined();
    expect(event.user).toEqual({ id: 'u1' });
    expect(Object.keys(event.contexts)).toEqual(['runtime', 'os']);
    expect(event.tags).toEqual({ organizationId: 'o1', runId: 'r1' });
    expect(event.exception.values[0].value).toBe(
      'failed for [email] with password=[redacted]',
    );
    expect(event.exception.values[0].stacktrace.frames[0]).toEqual({
      filename: 'f',
    });
  });
});

describe('captureJobFailure', () => {
  it('tags IDs only and never forwards job.data', () => {
    const err = new Error('boom');
    captureJobFailure(
      {
        id: 'j1',
        queueName: 'k6',
        data: {
          runId: 'r1',
          organizationId: 'o1',
          projectId: 'p1',
          script: 'SECRET',
          testName: 'n',
        },
      },
      err,
    );
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      tags: {
        jobId: 'j1',
        queue: 'k6',
        runId: 'r1',
        organizationId: 'o1',
        projectId: 'p1',
      },
    });
  });
});
