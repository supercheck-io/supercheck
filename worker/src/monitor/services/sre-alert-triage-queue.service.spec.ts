import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { SreAlertTriageQueueService } from './sre-alert-triage-queue.service';

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
