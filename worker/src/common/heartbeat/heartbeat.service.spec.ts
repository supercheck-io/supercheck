import { HeartbeatService, workerCapabilities } from './heartbeat.service';
import { ConfigService } from '@nestjs/config';
it('immediately publishes queue registration and removal instead of waiting for the next heartbeat', () => {
  const service = new HeartbeatService({
    get: (_key: string, fallback: unknown) => fallback,
  } as ConfigService);
  const redis = { set: jest.fn().mockResolvedValue('OK') };
  service['redis'] = redis as never;
  service.addQueues(['monitor-eu']);
  expect(JSON.parse(redis.set.mock.calls[0][1]).queues).toContain('monitor-eu');
  service.removeQueues(['monitor-eu']);
  expect(JSON.parse(redis.set.mock.calls[1][1]).queues).not.toContain(
    'monitor-eu',
  );
});

it('reports agent-test only when the fixture package resolves', () => {
  expect(workerCapabilities(() => '/x')).toEqual(['agent-test']);
  expect(
    workerCapabilities(() => {
      throw new Error('Cannot find module');
    }),
  ).toEqual([]);
});

describe('workerCapabilities with the execution image', () => {
  const ok = () => '/x';
  beforeEach(() => {
    process.env.SUPERCHECK_VERSION = '1.4.0';
  });
  afterEach(() => {
    delete process.env.SUPERCHECK_VERSION;
  });

  it.each([
    ['a matching tag', 'ghcr.io/o/worker:1.4.0', true],
    ['a matching v tag', 'ghcr.io/o/worker:v1.4.0', true],
    ['an older tag', 'ghcr.io/o/worker:1.3.9', false],
    ['a registry port and no tag', 'localhost:5000/worker', true],
    ['a digest', 'ghcr.io/o/worker:1.3.9@sha256:abc', true],
    ['latest', 'ghcr.io/o/worker:latest', true],
    ['a floating minor tag', 'ghcr.io/o/worker:1.6', true],
    ['a named tag', 'ghcr.io/o/worker:prod', true],
    ['an older v tag', 'ghcr.io/o/worker:v1.3.9', false],
    ['no image', undefined, true],
  ])('with %s', (_n, image, reported) => {
    expect(workerCapabilities(ok, { WORKER_IMAGE: image })).toEqual(
      reported ? ['agent-test'] : [],
    );
  });

  it('lets WORKER_CAPABILITIES replace detection', () => {
    const none = () => {
      throw new Error('missing');
    };
    expect(
      workerCapabilities(none, { WORKER_CAPABILITIES: ' agent-test, ' }),
    ).toEqual(['agent-test']);
    expect(workerCapabilities(ok, { WORKER_CAPABILITIES: '' })).toEqual([]);
  });
});

it.each([
  ['ghcr.io/o/worker:1.0.0', '1.0.0'],
  ['user:secret@reg.io/o/worker:1.0.0@sha256:abc123', '@sha256:abc123'],
  ['user:secret@reg.io/o/worker', null],
  ['localhost:5000/worker', null],
])(
  'heartbeat image of %s carries only the tag or digest',
  (image, expected) => {
    process.env.WORKER_IMAGE = image;
    const service = new HeartbeatService({
      get: (_key: string, fallback: unknown) => fallback,
    } as ConfigService);
    const redis = { set: jest.fn().mockResolvedValue('OK') };
    service['redis'] = redis as never;
    service.addQueues(['q']);
    delete process.env.WORKER_IMAGE;
    expect(JSON.parse(redis.set.mock.calls[0][1]).image).toBe(expected);
  },
);

it('publishes the worker version and image in the heartbeat', () => {
  process.env.WORKER_IMAGE = 'ghcr.io/o/worker:1.0.0';
  const service = new HeartbeatService({
    get: (_key: string, fallback: unknown) => fallback,
  } as ConfigService);
  const redis = { set: jest.fn().mockResolvedValue('OK') };
  service['redis'] = redis as never;
  service.addQueues(['q']);
  delete process.env.WORKER_IMAGE;
  const payload = JSON.parse(redis.set.mock.calls[0][1]);
  expect(payload.image).toBe('1.0.0');
  expect(typeof payload.version).toBe('string');
});
