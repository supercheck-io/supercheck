import { ConfigService } from '@nestjs/config';
import { MonitorAlertService } from './monitor-alert.service';
import { SreAlertTriageQueueService } from './sre-alert-triage-queue.service';

jest.mock('../../common/notification-provider-crypto', () => ({
  decryptNotificationProviderConfig: jest.fn((config) => config),
}));

describe('MonitorAlertService', () => {
  const monitor = {
    id: 'monitor-1',
    name: 'Checkout API',
    target: 'https://checkout.example.com',
    type: 'http_request',
    projectId: 'project-1',
    alertConfig: {
      enabled: true,
      alertOnFailure: true,
      alertOnRecovery: true,
      alertOnSslExpiration: true,
      customMessage: null,
    },
    frequencyMinutes: 5,
    lastCheckAt: new Date('2026-06-23T00:00:00Z'),
  };

  function createService() {
    const valuesMock = jest.fn(() => ({
      returning: jest.fn().mockResolvedValue([
        { id: 'history-1', status: 'sent' },
        { id: 'history-2', status: 'failed' },
      ]),
    }));
    const db = {
      query: {
        monitors: { findFirst: jest.fn().mockResolvedValue(monitor) },
        projects: { findFirst: jest.fn().mockResolvedValue({ name: 'Prod' }) },
      },
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          innerJoin: jest.fn(() => ({
            where: jest.fn().mockResolvedValue([
              {
                id: 'provider-1',
                type: 'webhook',
                config: { url: 'https://example.com/webhook' },
                projectId: 'project-1',
              },
            ]),
          })),
        })),
      })),
      insert: jest.fn(() => ({
        values: valuesMock,
      })),
    };
    const dbService = { db };
    const configService = {
      get: jest.fn((key: string) =>
        key === 'APP_URL' ? 'https://app.example.com' : undefined,
      ),
    } as unknown as ConfigService;
    const notificationService = {
      sendNotificationToMultipleProviders: jest.fn().mockResolvedValue({
        success: 1,
        failed: 1,
        results: [
          { provider: { id: 'provider-1' }, success: true, error: null },
          {
            provider: { id: 'provider-2' },
            success: false,
            error: 'failed',
            deliveryMetadata: {
              version: 1,
              provider: { id: 'provider-2', type: 'webhook' },
              source: {
                alertType: 'monitor_failure',
                targetType: 'monitor',
                targetId: 'monitor-1',
                projectId: 'project-1',
                monitorId: 'monitor-1',
              },
              delivery: {
                status: 'failed',
                sentAt: '2026-06-28T00:00:00.000Z',
              },
            },
          },
        ],
      }),
    };
    const sreAlertTriageQueueService = {
      enqueueAlertHistoryRows: jest.fn().mockResolvedValue(undefined),
    } as unknown as SreAlertTriageQueueService;

    const service = new MonitorAlertService(
      dbService as never,
      configService,
      notificationService as never,
      sreAlertTriageQueueService,
    );

    return { service, db, valuesMock, sreAlertTriageQueueService };
  }

  it('enqueues created alert-history rows after monitor notifications', async () => {
    const { service, valuesMock, sreAlertTriageQueueService } = createService();

    await service.sendNotification('monitor-1', 'failure', 'Timeout');

    expect(valuesMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'provider-2',
          deliveryMetadata: expect.objectContaining({
            version: 1,
            provider: { id: 'provider-2', type: 'webhook' },
          }),
        }),
      ]),
    );
    expect(
      sreAlertTriageQueueService.enqueueAlertHistoryRows,
    ).toHaveBeenCalledWith([
      { id: 'history-1', status: 'sent' },
      { id: 'history-2', status: 'failed' },
    ]);
  });

  it('enqueues created alert-history rows after SSL notifications', async () => {
    const { service, sreAlertTriageQueueService } = createService();

    await service.sendSslExpirationNotification(
      'monitor-1',
      'Certificate expires soon',
    );

    expect(
      sreAlertTriageQueueService.enqueueAlertHistoryRows,
    ).toHaveBeenCalledWith([
      { id: 'history-1', status: 'sent' },
      { id: 'history-2', status: 'failed' },
    ]);
  });
});
