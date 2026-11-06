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

  function createService(
    maintenance = false,
    lastOutageAlert: string | null = 'monitor_failure',
  ) {
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
    const maintenanceQuery = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest
        .fn()
        .mockResolvedValue(maintenance ? [{ id: 'maintenance' }] : []),
    };
    const historyQuery = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest
        .fn()
        .mockResolvedValue(lastOutageAlert ? [{ type: lastOutageAlert }] : []),
    };
    const selectProviders = db.select.getMockImplementation()!;
    (db.select as jest.Mock).mockImplementation((fields) =>
      'sentAt' in fields
        ? historyQuery
        : Object.keys(fields).length === 1
          ? maintenanceQuery
          : selectProviders(),
    );
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

    return {
      service,
      db,
      valuesMock,
      sreAlertTriageQueueService,
      notificationService,
    };
  }

  it('reports zero delivery as retryable and partial success as delivered', async () => {
    const { service, notificationService } = createService();
    notificationService.sendNotificationToMultipleProviders.mockResolvedValueOnce(
      {
        success: 0,
        failed: 1,
        results: [
          { provider: { id: 'provider-1' }, success: false, error: 'offline' },
        ],
      },
    );
    expect(
      await service.sendNotification('monitor-1', 'recovery', 'Recovered'),
    ).toEqual({ delivered: false });
    expect(
      await service.sendNotification('monitor-1', 'recovery', 'Recovered'),
    ).toEqual({ delivered: true });
  });

  it('counts a partially delivered provider as delivered so the alert is not resent', async () => {
    const { service, notificationService } = createService();
    notificationService.sendNotificationToMultipleProviders.mockResolvedValueOnce(
      {
        success: 0,
        failed: 1,
        results: [
          {
            provider: { id: 'provider-1' },
            success: false,
            partial: true,
            error: 'reached 1/2',
          },
        ],
      },
    );
    expect(
      await service.sendNotification('monitor-1', 'failure', 'Down'),
    ).toEqual({ delivered: true });
  });

  it('reports a monitor with no enabled providers as suppressed, not as a delivery failure', async () => {
    const { service, db } = createService();
    (db.select as jest.Mock).mockImplementation((fields) =>
      Object.keys(fields).length === 1
        ? {
            from: jest.fn().mockReturnThis(),
            innerJoin: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([]),
          }
        : {
            from: () => ({
              innerJoin: () => ({ where: jest.fn().mockResolvedValue([]) }),
            }),
          },
    );
    expect(
      await service.sendNotification('monitor-1', 'failure', 'Down'),
    ).toMatchObject({ suppressed: true });
  });

  it.each([
    ['no alert history', null],
    ['a recovery as the latest outage alert', 'monitor_recovery'],
  ])(
    'skips the recovery alert when no down alert was sent: %s',
    async (_n, last) => {
      const { service, notificationService } = createService(false, last);
      expect(
        await service.sendNotification('monitor-1', 'recovery', 'Recovered'),
      ).toEqual({ delivered: false, suppressed: true });
      expect(
        notificationService.sendNotificationToMultipleProviders,
      ).not.toHaveBeenCalled();
    },
  );

  it('does not report a delivered alert as failed when the history insert fails', async () => {
    const { service, valuesMock } = createService();
    valuesMock.mockImplementation(() => ({
      returning: jest.fn().mockRejectedValue(new Error('db down')),
    }));
    expect(
      await service.sendNotification('monitor-1', 'failure', 'Down'),
    ).toEqual({ delivered: true });
  });

  it('suppresses monitor notifications during a scheduled maintenance window', async () => {
    const { service, valuesMock, sreAlertTriageQueueService } =
      createService(true);
    await service.sendNotification('monitor-1', 'failure', 'Timeout');
    expect(valuesMock).not.toHaveBeenCalled();
    expect(
      sreAlertTriageQueueService.enqueueAlertHistoryRows,
    ).not.toHaveBeenCalled();
  });

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

    await expect(
      service.sendSslExpirationNotification(
        'monitor-1',
        'Certificate expires soon',
      ),
    ).resolves.toBe(true);

    expect(
      sreAlertTriageQueueService.enqueueAlertHistoryRows,
    ).toHaveBeenCalledWith([
      { id: 'history-1', status: 'sent' },
      { id: 'history-2', status: 'failed' },
    ]);
  });

  it('skips a provider whose config cannot be decrypted and keeps the rest', () => {
    const { service } = createService();
    const crypto = jest.requireMock(
      '../../common/notification-provider-crypto',
    );
    crypto.decryptNotificationProviderConfig.mockImplementationOnce(() => {
      throw new Error('bad auth tag');
    });
    const providers = service['decryptProviders']([
      { id: 'broken', type: 'webhook', config: {}, projectId: 'project-1' },
      {
        id: 'ok',
        type: 'webhook',
        config: { url: 'u' },
        projectId: 'project-1',
      },
    ] as never);
    expect(providers.map((p: { id: string }) => p.id)).toEqual(['ok']);
  });

  it('reports a delivery failure when no provider config can be decrypted', async () => {
    const { service, notificationService } = createService();
    const crypto = jest.requireMock(
      '../../common/notification-provider-crypto',
    );
    crypto.decryptNotificationProviderConfig.mockImplementationOnce(() => {
      throw new Error('bad auth tag');
    });
    await expect(
      service.sendNotification('monitor-1', 'failure', 'down'),
    ).resolves.toEqual({ delivered: false });
    expect(
      notificationService.sendNotificationToMultipleProviders,
    ).not.toHaveBeenCalled();
  });

  it('reports an SSL alert as not sent when no provider config can be decrypted', async () => {
    const { service } = createService();
    const crypto = jest.requireMock(
      '../../common/notification-provider-crypto',
    );
    crypto.decryptNotificationProviderConfig.mockImplementationOnce(() => {
      throw new Error('bad auth tag');
    });
    await expect(
      service.sendSslExpirationNotification('monitor-1', 'expiring'),
    ).resolves.toBe(false);
  });
});
