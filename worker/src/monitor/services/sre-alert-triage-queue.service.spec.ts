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

  it('does not create a queue when background triage is disabled', async () => {
    const service = new SreAlertTriageQueueService(configService);

    await service.enqueueAlertHistoryRows([
      { id: 'alert-history-1', status: 'sent' },
    ]);

    expect(mockQueueConstructor).not.toHaveBeenCalled();
  });

  it('does not enqueue failed alert deliveries', async () => {
    config.set('SRE_TRIAGE_AGENT_ENABLED', 'true');
    config.set('SRE_TRIAGE_AGENT_BACKGROUND_ENABLED', 'true');
    const service = new SreAlertTriageQueueService(configService);

    await service.enqueueAlertHistoryRows([
      { id: 'alert-history-1', status: 'failed' },
    ]);

    expect(mockQueueConstructor).not.toHaveBeenCalled();
  });

  it('enqueues deterministic jobs for sent alert deliveries', async () => {
    config.set('SRE_TRIAGE_AGENT_ENABLED', 'true');
    config.set('SRE_TRIAGE_AGENT_BACKGROUND_ENABLED', 'true');
    const service = new SreAlertTriageQueueService(configService);

    await service.enqueueAlertHistoryRows([
      { id: 'alert-history-1', status: 'sent' },
    ]);

    const queue = mockQueueConstructor.mock.results[0].value;
    expect(queue.add).toHaveBeenCalledWith(
      'triage-alert-history',
      { alertHistoryId: 'alert-history-1' },
      { jobId: 'sre-alert-triage:alert-history-1' },
    );
  });
});
