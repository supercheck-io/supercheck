import {
  consumesWorkerQueue,
  parseWorkerQueues,
  resetWorkerQueuesForTests,
  WORKER_QUEUE_TOKENS,
} from './worker-queues';

describe('worker-queues', () => {
  const original = process.env.WORKER_QUEUES;
  beforeEach(() => resetWorkerQueuesForTests());
  afterEach(() => {
    if (original === undefined) delete process.env.WORKER_QUEUES;
    else process.env.WORKER_QUEUES = original;
  });

  it.each([undefined, null, '', '   '])(
    'consumes everything when unset (%p), preserving existing installs',
    (raw) => {
      expect([...parseWorkerQueues(raw)].sort()).toEqual(
        [...WORKER_QUEUE_TOKENS].sort(),
      );
    },
  );

  describe('cloud production', () => {
    const env = { ...process.env };
    afterEach(() => {
      process.env = { ...env };
    });

    it('requires WORKER_QUEUES to be set explicitly', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SELF_HOSTED;
      expect(() => parseWorkerQueues(undefined)).toThrow(
        /must be set explicitly/,
      );
      expect(parseWorkerQueues('monitor').has('monitor')).toBe(true);
    });

    it('still defaults to everything for self-hosted production', () => {
      process.env.NODE_ENV = 'production';
      process.env.SELF_HOSTED = 'true';
      expect(parseWorkerQueues(undefined).size).toBe(
        WORKER_QUEUE_TOKENS.length,
      );
    });
  });

  it('parses a probe-only worker', () => {
    process.env.WORKER_QUEUES = 'monitor';
    expect(consumesWorkerQueue('monitor')).toBe(true);
    expect(consumesWorkerQueue('k6')).toBe(false);
    expect(consumesWorkerQueue('global-playwright')).toBe(false);
    expect(consumesWorkerQueue('global-k6')).toBe(false);
  });

  it('freezes the first read so decorators and services always agree', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.WORKER_QUEUES;
    expect(consumesWorkerQueue('global-playwright')).toBe(true);
    process.env.WORKER_QUEUES = 'monitor';
    expect(consumesWorkerQueue('global-playwright')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('is case/whitespace tolerant', () => {
    expect([...parseWorkerQueues(' Monitor , GLOBAL-k6 ')].sort()).toEqual([
      'global-k6',
      'monitor',
    ]);
  });

  it('fails fast on an unknown token', () => {
    expect(() => parseWorkerQueues('monitor,playwright')).toThrow(
      /Unknown token\(s\): playwright/,
    );
  });

  it('fails fast on a list with no tokens', () => {
    expect(() => parseWorkerQueues(',')).toThrow(/Invalid WORKER_QUEUES/);
  });
});
