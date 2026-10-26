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

// Mirrored in worker/src/monitor/services/sre-alert-triage-queue.service.spec.ts
// and app/src/sre/lib/feature-gates.spec.ts. Change both together.
// [SRE_ENABLED, SRE_AUTOMATION_ENABLED, automatic triage enabled]
const AUTOMATION_GATE_CONTRACT: Array<
  [string | undefined, string | undefined, boolean]
> = [
  [undefined, undefined, false],
  [undefined, 'true', true],
  [undefined, '1', true],
  [undefined, ' TRUE ', true],
  [undefined, 'yes', false],
  [undefined, 'false', false],
  ['true', 'true', true],
  ['false', 'true', false],
  ['0', '1', false],
  [' FALSE ', 'true', false],
  ['', 'true', true],
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

  it.each(AUTOMATION_GATE_CONTRACT)(
    'automation gate contract: SRE_ENABLED=%j SRE_AUTOMATION_ENABLED=%j -> %s',
    async (sre, automation, expected) => {
      if (sre !== undefined) config.set('SRE_ENABLED', sre);
      if (automation !== undefined)
        config.set('SRE_AUTOMATION_ENABLED', automation);
      await new SreAlertTriageQueueService(
        configService,
      ).enqueueAlertHistoryRows([{ id: 'alert-history-1', status: 'sent' }]);
      expect(mockQueueConstructor).toHaveBeenCalledTimes(expected ? 1 : 0);
    },
  );
});
