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

  it('does not create a queue when automation is unset (default off)', async () => {
    const service = new SreAlertTriageQueueService(configService);

    await service.enqueueAlertHistoryRows([
      { id: 'alert-history-1', status: 'sent' },
    ]);

    expect(mockQueueConstructor).not.toHaveBeenCalled();
  });

  it('does not enqueue failed alert deliveries', async () => {
    config.set('SRE_AUTOMATION_ENABLED', 'true');
    const service = new SreAlertTriageQueueService(configService);

    await service.enqueueAlertHistoryRows([
      { id: 'alert-history-1', status: 'failed' },
    ]);

    expect(mockQueueConstructor).not.toHaveBeenCalled();
  });

  it('enqueues deterministic jobs for sent alert deliveries when opted in', async () => {
    config.set('SRE_AUTOMATION_ENABLED', 'true');
    const service = new SreAlertTriageQueueService(configService);

    await service.enqueueAlertHistoryRows([
      { id: 'alert-history-1', status: 'sent' },
    ]);

    const queue = mockQueueConstructor.mock.results[0].value;
    expect(queue.add).toHaveBeenCalledWith(
      'triage-alert-history',
      { alertHistoryId: 'alert-history-1' },
      { jobId: 'sre-alert-triage-alert-history-1' },
    );
  });

  it.each(['false', '0', ' FALSE '])(
    'does not enqueue when SRE_ENABLED=%s even if automation is on',
    async (flag) => {
      config.set('SRE_ENABLED', flag);
      config.set('SRE_AUTOMATION_ENABLED', 'true');
      await new SreAlertTriageQueueService(
        configService,
      ).enqueueAlertHistoryRows([{ id: 'alert-history-1', status: 'sent' }]);
      expect(mockQueueConstructor).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'false', '0', ' FALSE ', 'yes'])(
    'does not enqueue when SRE_AUTOMATION_ENABLED=%j',
    async (flag) => {
      config.set('SRE_AUTOMATION_ENABLED', flag);
      await new SreAlertTriageQueueService(
        configService,
      ).enqueueAlertHistoryRows([{ id: 'alert-history-1', status: 'sent' }]);
      expect(mockQueueConstructor).not.toHaveBeenCalled();
    },
  );

  it.each(['true', '1', ' TRUE '])(
    'enqueues when SRE_AUTOMATION_ENABLED=%j and SRE_ENABLED is unset',
    async (flag) => {
      config.set('SRE_AUTOMATION_ENABLED', flag);
      await new SreAlertTriageQueueService(
        configService,
      ).enqueueAlertHistoryRows([{ id: 'alert-history-1', status: 'sent' }]);
      expect(mockQueueConstructor).toHaveBeenCalledTimes(1);
    },
  );
});
