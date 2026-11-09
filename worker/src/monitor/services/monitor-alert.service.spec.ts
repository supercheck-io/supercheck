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

  function createService(maintenance = false) {
    const valuesMock = jest.fn(() => ({
      returning: jest.fn().mockResolvedValue([
        { id: 'history-1', status: 'sent' },
        { id: 'history-2', status: 'failed' },
      ]),
    }));
    const db = {
      query: {
        monitors: { findFirst: jest.fn().mockResolvedValue(monitor) },
        monitorResults: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ checkedAt: new Date('2026-06-22T00:00:00Z') }),
        },
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
    const selectProviders = db.select.getMockImplementation()!;
    (db.select as jest.Mock).mockImplementation((fields) =>
      Object.keys(fields).length === 1 ? maintenanceQuery : selectProviders(),
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
      enqueueSourceFailure: jest.fn().mockResolvedValue(true),
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

  it('suppresses SSL expiry notifications during a scheduled maintenance window', async () => {
    const { service, valuesMock, notificationService } = createService(true);
    await expect(
      service.sendSslExpirationNotification('monitor-1', 'expires soon'),
    ).resolves.toBe(false);
    expect(
      notificationService.sendNotificationToMultipleProviders,
    ).not.toHaveBeenCalled();
    expect(valuesMock).not.toHaveBeenCalled();
  });

  it('signals an incident without any provider, and holds it back during maintenance', async () => {
    const { service, sreAlertTriageQueueService } = createService();
    (
      sreAlertTriageQueueService as unknown as Record<string, jest.Mock>
    ).enqueueSourceFailure = jest.fn().mockResolvedValue(true);
    await expect(
      service.signalFailure('monitor-1', 'down'),
    ).resolves.toMatchObject({
      suppressed: true,
      reason: 'incident_only',
    });
    expect(
      (sreAlertTriageQueueService as unknown as Record<string, jest.Mock>)
        .enqueueSourceFailure,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'monitor-1',
        type: 'monitor_failure',
      }),
    );

    const held = createService(true);
    (
      held.sreAlertTriageQueueService as unknown as Record<string, jest.Mock>
    ).enqueueSourceFailure = jest.fn().mockResolvedValue(true);
    await expect(
      held.service.signalFailure('monitor-1', 'down'),
    ).resolves.toMatchObject({ reason: 'maintenance' });
    expect(
      (held.sreAlertTriageQueueService as unknown as Record<string, jest.Mock>)
        .enqueueSourceFailure,
    ).not.toHaveBeenCalled();
  });

  it('stamps an incident-only failure with the failing cycle time even when sent after a later recovery cycle with a non-up result', async () => {
    const { service, sreAlertTriageQueueService } = createService();
    const failingCycle = new Date('2026-06-22T00:00:00Z');
    // A later recovery cycle contains a non-up result: nothing may be re-queried to find the time.
    const dbService = (
      service as unknown as {
        dbService: {
          db: { query: { monitorResults: { findFirst: jest.Mock } } };
        };
      }
    ).dbService;
    dbService.db.query.monitorResults.findFirst.mockResolvedValue({
      checkedAt: new Date('2026-06-22T00:10:00Z'),
    });
    await service.signalFailure('monitor-1', 'down', failingCycle);
    expect(
      sreAlertTriageQueueService.enqueueSourceFailure,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ firedAt: failingCycle.toISOString() }),
    );
    expect(dbService.db.query.monitorResults.findFirst).not.toHaveBeenCalled();
  });

  it('keeps the observation time on the no-provider path and on alert history rows', async () => {
    const failingCycle = '2026-06-22T00:00:00.000Z';
    const noProviders = createService();
    (noProviders.db.select as jest.Mock).mockImplementation((fields) =>
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
    await noProviders.service.sendNotification('monitor-1', 'failure', 'down', {
      observedAt: failingCycle,
    });
    expect(
      noProviders.sreAlertTriageQueueService.enqueueSourceFailure,
    ).toHaveBeenCalledWith(expect.objectContaining({ firedAt: failingCycle }));

    const delivered = createService();
    await delivered.service.sendNotification('monitor-1', 'failure', 'down', {
      observedAt: failingCycle,
    });
    expect(delivered.valuesMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ sentAt: new Date(failingCycle) }),
      ]),
    );
  });

  it('reports a rejected incident enqueue as a delivery failure, not as sent', async () => {
    const { service, sreAlertTriageQueueService } = createService();
    (
      sreAlertTriageQueueService.enqueueSourceFailure as jest.Mock
    ).mockResolvedValueOnce(false);
    await expect(service.signalFailure('monitor-1', 'down')).resolves.toEqual({
      delivered: false,
    });
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

  /** Makes the "already delivered channels" lookup (one selected column, `provider`) return rows. */
  function mockDeliveredChannels(db: { select: jest.Mock }, ids: string[]) {
    const original = db.select.getMockImplementation()!;
    db.select.mockImplementation((fields: Record<string, unknown>) =>
      'provider' in fields && Object.keys(fields).length === 1
        ? {
            from: () => ({
              where: jest
                .fn()
                .mockResolvedValue(ids.map((p) => ({ provider: p }))),
            }),
          }
        : original(fields),
    );
  }

  it('asks the caller to retry when only some channels failed, and retries only those', async () => {
    const { service, db, notificationService } = createService();
    const observedAt = new Date('2026-06-23T00:01:00Z').toISOString();
    await expect(
      service.sendNotification('monitor-1', 'failure', 'down', { observedAt }),
    ).resolves.toEqual({ delivered: true, retryFailedChannels: true });

    // Retry: provider-1 already has a 'sent' row for this observation time.
    mockDeliveredChannels(db, ['provider-1']);
    notificationService.sendNotificationToMultipleProviders.mockClear();
    await expect(
      service.sendNotification('monitor-1', 'failure', 'down', { observedAt }),
    ).resolves.toEqual({ delivered: true });
    expect(
      notificationService.sendNotificationToMultipleProviders,
    ).not.toHaveBeenCalled();
  });

  it('does not ask for a retry without an observation time', async () => {
    const { service } = createService();
    await expect(
      service.sendNotification('monitor-1', 'failure', 'down'),
    ).resolves.toEqual({ delivered: true });
  });

  it('still throttles an SSL alert whose history row could not be written', async () => {
    const { service, db, notificationService } = createService();
    db.insert.mockImplementation(() => {
      throw new Error('db down');
    });
    await expect(
      service.sendSslExpirationNotification('monitor-1', 'expiring'),
    ).resolves.toBe(true);
    notificationService.sendNotificationToMultipleProviders.mockClear();
    await expect(
      service.sendSslExpirationNotification('monitor-1', 'expiring'),
    ).resolves.toBe(false);
    expect(
      notificationService.sendNotificationToMultipleProviders,
    ).not.toHaveBeenCalled();
  });
});
