import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  RECOVERY_ENQUEUE_DELAYS_MS,
  SreAlertTriageQueueService,
} from './sre-alert-triage-queue.service';

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'queued-job' }),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

const mockQueueConstructor = Queue as unknown as jest.Mock;

// Incident pipeline gate: SRE_ENABLED only (AI triage is gated app-side).
// Mirrored in app/src/sre/lib/feature-gates.spec.ts.
const INCIDENT_GATE_CONTRACT: Array<[string | undefined, boolean]> = [
  [undefined, true],
  ['true', true],
  ['', true],
  ['false', false],
  ['0', false],
  [' FALSE ', false],
];

describe('SreAlertTriageQueueService', () => {
  const config = new Map<string, string | number>();
  const configService = {
    get: jest.fn((key: string, defaultValue?: string | number) =>
      config.has(key) ? config.get(key) : defaultValue,
    ),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    config.clear();
    config.set('REDIS_HOST', 'redis');
    config.set('REDIS_PORT', 6379);
  });

  it('enqueues by default without SRE_AUTOMATION_ENABLED', async () => {
    await new SreAlertTriageQueueService(configService).enqueueAlertHistoryRows(
      [{ id: 'alert-history-1', status: 'sent' }],
    );

    const queue = mockQueueConstructor.mock.results[0].value;
    expect(queue.add).toHaveBeenCalledWith(
      'triage-alert-history',
      { alertHistoryId: 'alert-history-1' },
      { jobId: 'sre-alert-triage-alert-history-1' },
    );
  });

  it('enqueues a source recovery with a per-recovery job id, and not when SRE is off', async () => {
    const recovery = {
      sourceType: 'monitor' as const,
      sourceId: 'm1',
      recoveredAt: '2026-10-28T10:00:00.000Z',
    };
    await expect(
      new SreAlertTriageQueueService(configService).enqueueSourceRecovery(
        recovery,
      ),
    ).resolves.toBe(true);
    const queue = mockQueueConstructor.mock.results[0].value;
    expect(queue.add).toHaveBeenCalledWith(
      'source-recovery',
      { sourceRecovery: recovery },
      {
        jobId: `sre-recovery-monitor-m1-${Date.parse(recovery.recoveredAt)}`,
      },
    );

    config.set('SRE_ENABLED', 'false');
    mockQueueConstructor.mockClear();
    await expect(
      new SreAlertTriageQueueService(configService).enqueueSourceRecovery(
        recovery,
      ),
    ).resolves.toBe(true);
    expect(mockQueueConstructor).not.toHaveBeenCalled();
  });

  it('retries a failed source recovery enqueue in place and reports false when every attempt fails', async () => {
    jest.useFakeTimers();
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const add = jest.fn().mockRejectedValue(new Error('redis down'));
    mockQueueConstructor.mockImplementationOnce(() => ({
      add,
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    }));
    const result = new SreAlertTriageQueueService(
      configService,
    ).enqueueSourceRecovery({
      sourceType: 'monitor',
      sourceId: 'm1',
      recoveredAt: '2026-10-28T10:00:00.000Z',
    });
    await jest.runAllTimersAsync();
    await expect(result).resolves.toBe(false);
    expect(add).toHaveBeenCalledTimes(RECOVERY_ENQUEUE_DELAYS_MS.length + 1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
    jest.useRealTimers();
  });

  it('succeeds when a retry of the source recovery enqueue goes through', async () => {
    jest.useFakeTimers();
    const add = jest
      .fn()
      .mockRejectedValueOnce(new Error('redis blip'))
      .mockResolvedValue({ id: 'queued-job' });
    mockQueueConstructor.mockImplementationOnce(() => ({
      add,
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    }));
    const result = new SreAlertTriageQueueService(
      configService,
    ).enqueueSourceRecovery({
      sourceType: 'monitor',
      sourceId: 'm1',
      recoveredAt: '2026-10-28T10:00:00.000Z',
    });
    await jest.runAllTimersAsync();
    await expect(result).resolves.toBe(true);
    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls[0][2]).toEqual(add.mock.calls[1][2]);
    jest.useRealTimers();
  });

  it('enqueues failed deliveries but not pending ones', async () => {
    await new SreAlertTriageQueueService(configService).enqueueAlertHistoryRows(
      [
        { id: 'h-failed', status: 'failed' },
        { id: 'h-pending', status: 'pending' },
      ],
    );

    const queue = mockQueueConstructor.mock.results[0].value;
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][1]).toEqual({ alertHistoryId: 'h-failed' });
  });

  it('does not enqueue when only pending rows are given', async () => {
    await new SreAlertTriageQueueService(configService).enqueueAlertHistoryRows(
      [{ id: 'h-pending', status: 'pending' }],
    );
    expect(mockQueueConstructor).not.toHaveBeenCalled();
  });

  it('logs an enqueue failure and does not throw', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const failure = new Error('redis down');
    mockQueueConstructor.mockImplementationOnce(() => ({
      add: jest.fn().mockRejectedValue(failure),
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    }));

    await expect(
      new SreAlertTriageQueueService(configService).enqueueAlertHistoryRows([
        { id: 'alert-history-1', status: 'sent' },
      ]),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to enqueue SRE alert triage jobs',
      failure,
    );
    errorSpy.mockRestore();
  });

  it.each(INCIDENT_GATE_CONTRACT)(
    'incident gate contract: SRE_ENABLED=%j -> %s',
    async (sre, expected) => {
      if (sre !== undefined) config.set('SRE_ENABLED', sre);
      await new SreAlertTriageQueueService(
        configService,
      ).enqueueAlertHistoryRows([{ id: 'alert-history-1', status: 'sent' }]);
      expect(mockQueueConstructor).toHaveBeenCalledTimes(expected ? 1 : 0);
    },
  );
});
