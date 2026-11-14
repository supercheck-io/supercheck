import { ConfigService } from '@nestjs/config';
import {
  MAX_CLAIM_ATTEMPTS,
  MonitorAlertService,
  redactAlertText,
} from './monitor-alert.service';
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

  it('redacts URL credentials and secret query values before persisting', () => {
    const cases = [
      [
        'GET https://u:p@example.com/health?token=abc&page=2 failed',
        ['u:p', 'abc'],
      ],
      ["failed 'https://u:p'w@h.example/x?token=a'b'", ["p'w", "a'b"]],
      ['GET http://[::1]:8080/x?token=abc failed', ['abc']],
      ['see (https://h.example/p?api_key=v).', ['=v)']],
    ] as const;
    for (const [text, secrets] of cases) {
      const out = redactAlertText(text) ?? '';
      for (const secret of secrets) expect(out).not.toContain(secret);
    }
    expect(redactAlertText('GET https://example.com/?page=2 failed')).toContain(
      'page=2',
    );
    expect(redactAlertText('see (https://h.example/p?api_key=v).')).toMatch(
      /\)\.$/,
    );
    expect(redactAlertText(undefined)).toBeUndefined();
  });

  it('persists redacted errors and passes the check time to the payload', async () => {
    const { service, valuesMock, notificationService } = createService();
    notificationService.sendNotificationToMultipleProviders.mockResolvedValueOnce(
      {
        success: 0,
        failed: 1,
        results: [
          {
            provider: { id: 'provider-1' },
            success: false,
            error: 'POST https://a:b@hook.example.com/x?token=s3cret 500',
          },
        ],
      },
    );
    const observedAt = '2026-06-23T00:01:00.000Z';
    await service.sendNotification('monitor-1', 'failure', 'down', {
      observedAt,
    });
    const payload =
      notificationService.sendNotificationToMultipleProviders.mock.calls[0][1];
    expect(payload.metadata.observedAt).toBe(observedAt);
    expect(payload.timestamp.toISOString()).toBe(observedAt);
    const rows = (valuesMock.mock.calls[0] as unknown[])[0] as {
      errorMessage: string;
    }[];
    expect(rows[0].errorMessage).not.toMatch(/s3cret|a:b/);
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

  it('prunes expired SSL throttle entries', async () => {
    const { service } = createService();
    const map = service['sslAlertDeliveredAt'];
    map.set('old-monitor', Date.now() - 25 * 60 * 60 * 1000);
    await service.sendSslExpirationNotification('monitor-1', 'expiring');
    expect(map.has('old-monitor')).toBe(false);
    expect(map.has('monitor-1')).toBe(true);
  });

  describe('claimed delivery', () => {
    const claim = { outageKey: 'key-1', ordinal: 0 };

    /** Adds the claim statements to the shared mock db: the upsert result and what other claims look like. */
    function withClaims(
      ctx: ReturnType<typeof createService>,
      options: {
        claimed?: Array<{ id: string; provider: string; attempts: number }>;
        existing?: Array<{ status: string }>;
        claimFails?: boolean;
        updateFailures?: number;
      } = {},
    ) {
      const { db, valuesMock } = ctx;
      const conflict = jest.fn(() => ({
        returning: options.claimFails
          ? jest.fn().mockRejectedValue(new Error('claim failed'))
          : jest.fn().mockResolvedValue(
              (options.claimed ?? []).map((row) => ({
                ...row,
              })),
            ),
      }));
      const insertRows = valuesMock.getMockImplementation()!;
      valuesMock.mockImplementation(((rows: unknown) => ({
        ...insertRows(),
        onConflictDoUpdate: conflict,
        rows,
      })) as never);
      const baseSelect = (db.select as jest.Mock).getMockImplementation()!;
      (db.select as jest.Mock).mockImplementation((fields) =>
        fields && Object.keys(fields).join() === 'status'
          ? { from: () => ({ where: async () => options.existing ?? [] }) }
          : baseSelect(fields),
      );
      let failures = options.updateFailures ?? 0;
      const where = jest.fn(async () => {
        if (failures-- > 0) throw new Error('update failed');
      });
      const set = jest.fn(() => ({ where }));
      (db as unknown as { update: jest.Mock }).update = jest.fn(() => ({
        set,
      }));
      return { conflict, set, where };
    }

    const both = [
      { id: 'row-1', provider: 'provider-1', attempts: 1 },
      { id: 'row-2', provider: 'provider-2', attempts: 1 },
    ];
    const twoProviders = (ctx: ReturnType<typeof createService>) => {
      // createService returns one provider; fan out to two for these cases.
      (ctx.db.select as jest.Mock).mockImplementation((fields) =>
        Object.keys(fields).length === 1
          ? {
              from: jest.fn().mockReturnThis(),
              innerJoin: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              limit: jest.fn().mockResolvedValue([]),
            }
          : {
              from: () => ({
                innerJoin: () => ({
                  where: jest.fn().mockResolvedValue(
                    ['provider-1', 'provider-2'].map((id) => ({
                      id,
                      type: 'webhook',
                      config: { url: 'https://example.com/hook' },
                      projectId: 'project-1',
                    })),
                  ),
                }),
              }),
            },
      );
    };

    it('sends to the claimed providers and finishes their rows; a failed one stays owed', async () => {
      const ctx = createService();
      twoProviders(ctx);
      const { set } = withClaims(ctx, { claimed: both });
      const result = await ctx.service.sendNotification(
        'monitor-1',
        'failure',
        'Down',
        {},
        claim,
      );
      // provider-1 delivered, provider-2 failed with attempts left: the alert is still owed.
      expect(result).toEqual({ delivered: false });
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'sent' }),
      );
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', errorMessage: 'failed' }),
      );
      expect(
        ctx.sreAlertTriageQueueService.enqueueAlertHistoryRows,
      ).toHaveBeenCalledWith([
        { id: 'row-1', status: 'sent' },
        { id: 'row-2', status: 'failed' },
      ]);
    });

    it('finishes a 401/403 (terminal) failure with attempts used up, so no later check retries it', async () => {
      const ctx = createService();
      twoProviders(ctx);
      const { set } = withClaims(ctx, { claimed: both });
      const results = (
        await ctx.notificationService.sendNotificationToMultipleProviders()
      ).results;
      results[1].deliveryMetadata.delivery = {
        ...results[1].deliveryMetadata.delivery,
        terminal: true,
        responseStatus: 401,
      };
      ctx.notificationService.sendNotificationToMultipleProviders.mockResolvedValueOnce(
        { success: 1, failed: 1, results },
      );
      const result = await ctx.service.sendNotification(
        'monitor-1',
        'failure',
        'Down',
        {},
        claim,
      );
      // provider-2 is not owed any more: the delivered provider-1 makes the alert done.
      expect(result).toEqual({ delivered: true });
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          claimAttempts: MAX_CLAIM_ATTEMPTS,
        }),
      );
      expect(set).toHaveBeenCalledWith(
        expect.not.objectContaining({ claimAttempts: expect.anything() }),
      );
    });

    it('counts a failed provider whose attempts are used up as given up', async () => {
      const ctx = createService();
      twoProviders(ctx);
      withClaims(ctx, {
        claimed: [
          both[0],
          { id: 'row-2', provider: 'provider-2', attempts: 5 },
        ],
      });
      expect(
        await ctx.service.sendNotification(
          'monitor-1',
          'failure',
          'Down',
          {},
          claim,
        ),
      ).toEqual({ delivered: true });
    });

    it('sends nothing and reports delivered when every provider already has the alert', async () => {
      const ctx = createService();
      twoProviders(ctx);
      withClaims(ctx, { existing: [{ status: 'sent' }, { status: 'sent' }] });
      expect(
        await ctx.service.sendNotification(
          'monitor-1',
          'failure',
          'Down',
          {},
          claim,
        ),
      ).toEqual({ delivered: true, alreadySent: true });
      expect(
        ctx.notificationService.sendNotificationToMultipleProviders,
      ).not.toHaveBeenCalled();
    });

    it('reports nothing delivered when the other providers are out of attempts and none ever sent', async () => {
      const ctx = createService();
      twoProviders(ctx);
      withClaims(ctx, {
        existing: [{ status: 'failed' }, { status: 'failed' }],
      });
      expect(
        await ctx.service.sendNotification(
          'monitor-1',
          'failure',
          'Down',
          {},
          claim,
        ),
      ).toEqual({ delivered: false, gaveUp: true });
    });

    it('leaves an alert another evaluator is sending to it', async () => {
      const ctx = createService();
      twoProviders(ctx);
      withClaims(ctx, {
        existing: [{ status: 'pending' }, { status: 'sent' }],
      });
      expect(
        await ctx.service.sendNotification(
          'monitor-1',
          'failure',
          'Down',
          {},
          claim,
        ),
      ).toEqual({ delivered: false, suppressed: true, reason: 'claimed' });
    });

    it('stays in flight when it sent to some providers and another evaluator holds the rest', async () => {
      const ctx = createService();
      twoProviders(ctx);
      withClaims(ctx, {
        claimed: [both[0]],
        existing: [{ status: 'pending' }],
      });
      expect(
        await ctx.service.sendNotification(
          'monitor-1',
          'failure',
          'Down',
          {},
          claim,
        ),
      ).toMatchObject({ suppressed: true, reason: 'claimed' });
    });

    it('keeps the rows it claimed when reading the other claims fails, and does not send unreserved', async () => {
      const ctx = createService();
      twoProviders(ctx);
      withClaims(ctx, { claimed: [both[0]] });
      const select = (ctx.db.select as jest.Mock).getMockImplementation()!;
      (ctx.db.select as jest.Mock).mockImplementation((fields) =>
        fields && Object.keys(fields).join() === 'status'
          ? {
              from: () => ({
                where: async () => {
                  throw new Error('read failed');
                },
              }),
            }
          : select(fields),
      );
      const result = await ctx.service.sendNotification(
        'monitor-1',
        'failure',
        'Down',
        {},
        claim,
      );
      // It sent to the provider it claimed and finished that row; the unknown one is left held.
      expect(result).toMatchObject({ suppressed: true, reason: 'claimed' });
      expect(
        ctx.notificationService.sendNotificationToMultipleProviders,
      ).toHaveBeenCalledTimes(1);
      expect(
        ctx.sreAlertTriageQueueService.enqueueAlertHistoryRows,
      ).toHaveBeenCalledWith([{ id: 'row-1', status: 'sent' }]);
    });

    it('sends unreserved and records history afterwards when the claim cannot be made', async () => {
      const ctx = createService();
      withClaims(ctx, { claimFails: true });
      const result = await ctx.service.sendNotification(
        'monitor-1',
        'failure',
        'Down',
        {},
        claim,
      );
      expect(result).toEqual({ delivered: true });
      expect(
        ctx.sreAlertTriageQueueService.enqueueAlertHistoryRows,
      ).toHaveBeenCalled();
    });

    it('retries a row update that fails, and does not report a delivered alert as failed when it keeps failing', async () => {
      const retried = createService();
      const { where } = withClaims(retried, {
        claimed: [both[0]],
        updateFailures: 1,
      });
      expect(
        (
          await retried.service.sendNotification(
            'monitor-1',
            'recovery',
            'Up',
            {},
            claim,
          )
        ).delivered,
      ).toBe(true);
      expect(where).toHaveBeenCalledTimes(2);

      const broken = createService();
      withClaims(broken, { claimed: [both[0]], updateFailures: 99 });
      expect(
        (
          await broken.service.sendNotification(
            'monitor-1',
            'recovery',
            'Up',
            {},
            claim,
          )
        ).delivered,
      ).toBe(true);
    });

    it('sends the SSL renewed notice as informational, claimed under its warning id, and never queues it for triage', async () => {
      const ctx = createService();
      const { conflict } = withClaims(ctx, {
        claimed: [both[0]],
        existing: [],
      });
      ctx.notificationService.sendNotificationToMultipleProviders.mockResolvedValueOnce(
        {
          success: 1,
          failed: 0,
          results: [{ provider: { id: 'provider-1' }, success: true }],
        },
      );
      await expect(
        ctx.service.sendSslRenewedNotification(
          'monitor-1',
          'SSL certificate renewed (valid until 2027-02-01)',
          { observedAt: new Date('2026-12-05T00:00:00Z') },
          { outageKey: 'warning-1', ordinal: 0 },
        ),
      ).resolves.toMatchObject({ delivered: true });
      expect(conflict).toHaveBeenCalled();
      expect(
        ctx.notificationService.sendNotificationToMultipleProviders,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'ssl_renewed',
          severity: 'success',
          title: 'SSL Certificate Renewed - Checkout API',
          message: 'SSL certificate renewed (valid until 2027-02-01)',
        }),
        expect.any(Function),
      );
      expect(
        ctx.sreAlertTriageQueueService.enqueueAlertHistoryRows,
      ).not.toHaveBeenCalled();
    });

    it('does not throttle the renewed notice with the warning throttle', async () => {
      const ctx = createService();
      await ctx.service.sendSslExpirationNotification('monitor-1', 'expiring');
      withClaims(ctx, { claimed: [both[0]] });
      ctx.notificationService.sendNotificationToMultipleProviders.mockResolvedValueOnce(
        {
          success: 1,
          failed: 0,
          results: [{ provider: { id: 'provider-1' }, success: true }],
        },
      );
      await expect(
        ctx.service.sendSslRenewedNotification(
          'monitor-1',
          'renewed',
          {},
          { outageKey: 'warning-1', ordinal: 0 },
        ),
      ).resolves.toMatchObject({ delivered: true });
    });

    it('states what happened in a renewed notice instead of using the monitor custom message', async () => {
      const ctx = createService();
      withClaims(ctx, { claimed: [both[0]] });
      const alertConfig = monitor.alertConfig as { customMessage: unknown };
      alertConfig.customMessage = 'API is on fire';
      try {
        await ctx.service.sendSslRenewedNotification(
          'monitor-1',
          'SSL certificate renewed (valid until 2027-02-01)',
          {},
          { outageKey: 'warning-1', ordinal: 0 },
        );
      } finally {
        alertConfig.customMessage = null;
      }
      expect(
        ctx.notificationService.sendNotificationToMultipleProviders,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          message: 'SSL certificate renewed (valid until 2027-02-01)',
        }),
        expect.any(Function),
      );
    });

    it('finishes a provider row as soon as its own send settles, before a slower provider is done', async () => {
      const ctx = createService();
      twoProviders(ctx);
      const { set, where } = withClaims(ctx, { claimed: both });
      const order: string[] = [];
      set.mockImplementation(((v: { status: string }) => {
        order.push(`row:${v.status}`);
        return { where };
      }) as never);
      ctx.notificationService.sendNotificationToMultipleProviders.mockImplementationOnce(
        (async (
          _providers: unknown,
          _payload: unknown,
          onSettled: (entry: unknown) => Promise<void>,
        ) => {
          await onSettled({ provider: { id: 'provider-1' }, success: true });
          order.push('slow provider still sending');
          await onSettled({
            provider: { id: 'provider-2' },
            success: false,
            error: 'timeout',
          });
          return {
            success: 1,
            failed: 1,
            results: [
              { provider: { id: 'provider-1' }, success: true },
              {
                provider: { id: 'provider-2' },
                success: false,
                error: 'timeout',
              },
            ],
          };
        }) as never,
      );
      await ctx.service.sendNotification(
        'monitor-1',
        'failure',
        'Down',
        {},
        claim,
      );
      expect(order).toEqual([
        'row:sent',
        'slow provider still sending',
        'row:failed',
      ]);
      // Results already handed over are not written a second time.
      expect(set).toHaveBeenCalledTimes(2);
    });

    it('opens the incident from the delivery it knows happened when the outcome cannot be recorded, and records it later', async () => {
      const ctx = createService();
      const { where } = withClaims(ctx, {
        claimed: [both[0]],
        updateFailures: 5, // every in-process attempt of the first alert
      });
      const first = await ctx.service.sendNotification(
        'monitor-1',
        'failure',
        'Down',
        { observedAt: '2026-06-23T00:00:00.000Z' },
        claim,
      );
      // The provider accepted it: delivered, not a failure to retry from the evaluator.
      expect(first).toEqual({ delivered: true });
      expect(where).toHaveBeenCalledTimes(5);
      expect(
        ctx.sreAlertTriageQueueService.enqueueAlertHistoryRows,
      ).toHaveBeenCalledWith([]);
      expect(
        ctx.sreAlertTriageQueueService.enqueueSourceFailure,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: 'monitor',
          sourceId: 'monitor-1',
          type: 'monitor_failure',
          firedAt: '2026-06-23T00:00:00.000Z',
        }),
      );

      // The next alert from this process first writes the outcome it still holds, while the row is not stale.
      await ctx.service.sendNotification(
        'monitor-1',
        'recovery',
        'Up',
        {},
        {
          outageKey: 'key-2',
          ordinal: 0,
        },
      );
      expect(where).toHaveBeenCalledTimes(7); // the held outcome, then the recovery's own row
    });

    it('titles the notice as readable again when asked', async () => {
      const ctx = createService();
      withClaims(ctx, { claimed: [both[0]] });
      ctx.notificationService.sendNotificationToMultipleProviders.mockResolvedValueOnce(
        {
          success: 1,
          failed: 0,
          results: [{ provider: { id: 'provider-1' }, success: true }],
        },
      );
      await ctx.service.sendSslRenewedNotification(
        'monitor-1',
        'SSL certificate readable again',
        { readableAgain: true },
        { outageKey: 'warning-1', ordinal: 0 },
      );
      expect(
        ctx.notificationService.sendNotificationToMultipleProviders,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          title: 'SSL Certificate Readable Again - Checkout API',
        }),
        expect.any(Function),
      );
    });

    it('reports a gave-up alert when every provider is out of attempts and none was sent', async () => {
      const ctx = createService();
      twoProviders(ctx);
      withClaims(ctx, {
        existing: [{ status: 'failed' }, { status: 'failed' }],
      });
      await expect(
        ctx.service.sendSslRenewedNotification(
          'monitor-1',
          'renewed',
          {},
          { outageKey: 'warning-1', ordinal: 0 },
        ),
      ).resolves.toEqual({ delivered: false, gaveUp: true });

      // Still owed (attempts left) or delivered: not given up.
      const owed = createService();
      withClaims(owed, { claimed: [both[0]] });
      owed.notificationService.sendNotificationToMultipleProviders.mockResolvedValueOnce(
        {
          success: 0,
          failed: 1,
          results: [
            { provider: { id: 'provider-1' }, success: false, error: 'down' },
          ],
        },
      );
      await expect(
        owed.service.sendSslRenewedNotification(
          'monitor-1',
          'renewed',
          {},
          { outageKey: 'warning-1', ordinal: 0 },
        ),
      ).resolves.toEqual({ delivered: false, gaveUp: undefined });
    });
  });
});
