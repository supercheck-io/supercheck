import { Logger } from '@nestjs/common';
import {
  isFailureAlertStreak,
  JobNotificationService,
  maxFailureAlertStreak,
} from './job-notification.service';
import { RUN_CANCELLATION_MARKER } from '../../common/services/cancellation.service';

describe('JobNotificationService', () => {
  function createService() {
    const dbService: Record<string, jest.Mock> = {
      getJobById: jest.fn().mockResolvedValue({
        id: 'job-1',
        name: 'Checkout smoke test',
        projectId: 'project-1',
        alertConfig: {
          enabled: true,
          notificationProviders: ['provider-1', 'provider-2'],
          failureThreshold: 1,
          recoveryThreshold: 1,
          alertOnFailure: true,
          alertOnSuccess: true,
          alertOnTimeout: true,
          customMessage: undefined,
        },
      }),
      getNotificationProviders: jest.fn().mockResolvedValue([
        { id: 'provider-1', type: 'webhook', config: {} },
        { id: 'provider-2', type: 'webhook', config: {} },
      ]),
      getProjectById: jest.fn().mockResolvedValue({ name: 'Prod' }),
      getRecentRunsForJob: jest.fn().mockResolvedValue([]),
      getJobAlertStreakState: jest
        .fn()
        .mockResolvedValue({ sent: 0, lastSentAt: null }),
      saveAlertHistory: jest
        .fn()
        .mockResolvedValueOnce({ id: 'history-1', status: 'sent' })
        .mockResolvedValueOnce({ id: 'history-2', status: 'failed' }),
      // Like the real claim: reserve a row per provider when the gate still allows the alert.
      claimJobAlertSlots: jest.fn(
        async (input: {
          providerIds: string[];
          shouldAlert: (state: unknown) => boolean;
        }) =>
          input.shouldAlert(await dbService.getJobAlertStreakState())
            ? new Map(input.providerIds.map((id) => [id, `row-${id}`]))
            : new Map<string, string>(),
      ),
      finishJobAlert: jest.fn().mockResolvedValue(undefined),
    };
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
                alertType: 'job_failed',
                targetType: 'job',
                targetId: 'job-1',
                projectId: 'project-1',
                jobId: 'job-1',
                runId: 'run-1',
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
      enqueueSourceRecovery: jest.fn().mockResolvedValue(undefined),
    };

    const service = new JobNotificationService(
      dbService as never,
      notificationService as never,
      sreAlertTriageQueueService as never,
    );

    return {
      service,
      dbService,
      notificationService,
      sreAlertTriageQueueService,
    };
  }

  it('enqueues created alert-history rows after job notifications', async () => {
    const { service, dbService, sreAlertTriageQueueService } = createService();

    await service.handleJobNotifications({
      jobId: 'job-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      runId: 'run-1',
      finalStatus: 'failed',
      durationSeconds: 42,
      results: [{ success: false }],
    });

    expect(dbService.saveAlertHistory).not.toHaveBeenCalled();
    expect(dbService.finishJobAlert).toHaveBeenCalledTimes(2);
    expect(dbService.finishJobAlert).toHaveBeenLastCalledWith(
      'row-provider-2',
      'failed',
      'failed',
      expect.objectContaining({
        version: 1,
        provider: { id: 'provider-2', type: 'webhook' },
      }),
    );
    expect(
      sreAlertTriageQueueService.enqueueAlertHistoryRows,
    ).toHaveBeenCalledWith([
      { id: 'row-provider-1', status: 'sent' },
      { id: 'row-provider-2', status: 'failed' },
    ]);
  });
  it.each(['failed', 'passed', 'error'] as const)(
    'counts the current %s run once at the threshold boundary',
    async (status) => {
      const { service, dbService, notificationService } = createService();
      const job = await dbService.getJobById();
      job.alertConfig.failureThreshold = 2;
      job.alertConfig.recoveryThreshold = 2;
      dbService.getRecentRunsForJob.mockResolvedValue([
        { id: 'run-1', status },
        { id: 'previous', status: status === 'passed' ? 'failed' : 'passed' },
      ]);
      await service.handleJobNotifications({
        jobId: 'job-1',
        runId: 'run-1',
        finalStatus: status,
        durationSeconds: 1,
      });
      expect(
        notificationService.sendNotificationToMultipleProviders,
      ).not.toHaveBeenCalled();

      dbService.getRecentRunsForJob.mockResolvedValue([
        { id: 'run-1', status },
        { id: 'previous', status },
      ]);
      await service.handleJobNotifications({
        jobId: 'job-1',
        runId: 'run-1',
        finalStatus: status,
        durationSeconds: 1,
      });
      expect(
        notificationService.sendNotificationToMultipleProviders,
      ).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          metadata: expect.objectContaining(
            status === 'passed'
              ? { consecutiveSuccesses: 2 }
              : { consecutiveFailures: 2 },
          ),
        }),
      );
    },
  );

  describe('timeout and error paths', () => {
    const params = {
      jobId: 'job-1',
      runId: 'run-1',
      finalStatus: 'timeout',
      durationSeconds: 90,
    } as never;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
      errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => errorSpy.mockRestore());

    it('sends a job_timeout warning payload and records it as job_timeout history', async () => {
      const { service, dbService, notificationService } = createService();
      await service.handleJobNotifications(params);

      expect(
        notificationService.sendNotificationToMultipleProviders,
      ).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          type: 'job_timeout',
          severity: 'warning',
          title: 'Job Timeout - Checkout smoke test',
          message: expect.stringContaining('timed out after 90 seconds'),
          targetId: 'job-1',
          metadata: expect.objectContaining({
            runId: 'run-1',
            duration: 90,
            status: 'timeout',
          }),
        }),
      );
      expect(dbService.claimJobAlertSlots).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'job-1',
          runId: 'run-1',
          type: 'job_timeout',
          providerIds: ['provider-1', 'provider-2'],
        }),
      );
      expect(dbService.finishJobAlert).toHaveBeenCalledTimes(2);
    });

    // [prior failed runs, alerts sent, failure after which the last one went out, notifies]
    it.each([
      [0, 0, undefined, false],
      [1, 0, undefined, false],
      [2, 0, undefined, true], // third consecutive failed/timed-out run reaches threshold 3
      [3, 1, 3, false],
      [8, 1, 3, true], // reminder at threshold + 6
      [14, 2, 9, true], // second reminder
      [20, 3, 15, false], // capped at 3 alerts sent
    ])(
      'applies the failure threshold, cadence and cap to timeouts (%i prior failed runs, %i sent -> %s)',
      async (priorFailed, sent, sentAtFailure, notifies) => {
        const { service, dbService, notificationService } = createService();
        (await dbService.getJobById()).alertConfig.failureThreshold = 3;
        dbService.getJobAlertStreakState.mockResolvedValue({
          sent,
          lastSentAt:
            sentAtFailure === undefined
              ? null
              : new Date((sentAtFailure + 0.5) * 1000),
        });
        dbService.getRecentRunsForJob.mockResolvedValue(
          Array.from({ length: priorFailed }, (_, i) => ({
            id: `old-${i}`,
            status: i % 2 ? 'error' : 'failed',
            createdAt: new Date((priorFailed - i) * 1000),
          })),
        );
        await service.handleJobNotifications(params);
        const calls =
          notificationService.sendNotificationToMultipleProviders.mock.calls;
        expect(calls).toHaveLength(notifies ? 1 : 0);
        if (notifies) expect(calls[0][1].type).toBe('job_timeout');
      },
    );

    it('treats a timeout as an ordinary failure when alertOnTimeout is off', async () => {
      const { service, dbService, notificationService } = createService();
      (await dbService.getJobById()).alertConfig.alertOnTimeout = false;
      await service.handleJobNotifications(params);
      expect(
        notificationService.sendNotificationToMultipleProviders,
      ).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ type: 'job_failed' }),
      );
    });

    it('does not notify on timeout when both alertOnTimeout and alertOnFailure are off', async () => {
      const { service, dbService, notificationService } = createService();
      const { alertConfig } = await dbService.getJobById();
      alertConfig.alertOnTimeout = false;
      alertConfig.alertOnFailure = false;
      await service.handleJobNotifications(params);
      expect(
        notificationService.sendNotificationToMultipleProviders,
      ).not.toHaveBeenCalled();
    });

    it('logs and swallows an alert-history save failure', async () => {
      const { service, dbService, sreAlertTriageQueueService } =
        createService();
      dbService.finishJobAlert
        .mockReset()
        .mockRejectedValue(new Error('db down'));
      await expect(
        service.handleJobNotifications(params),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to save alert history row for job job-1: db down',
        ),
      );
      expect(
        sreAlertTriageQueueService.enqueueAlertHistoryRows,
      ).toHaveBeenCalledWith([]);
    });

    it('sends unreserved and records afterwards when the slot cannot be reserved', async () => {
      const { service, dbService, notificationService } = createService();
      dbService.claimJobAlertSlots.mockRejectedValue(new Error('db down'));
      dbService.saveAlertHistory
        .mockReset()
        .mockRejectedValue(new Error('db down'));
      await service.handleJobNotifications(params);
      expect(
        notificationService.sendNotificationToMultipleProviders,
      ).toHaveBeenCalledTimes(1);
      expect(dbService.finishJobAlert).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to reserve alert slot'),
      );
      expect(dbService.saveAlertHistory).toHaveBeenCalled();
    });

    it('sends nothing when every provider slot was already claimed for the run', async () => {
      const { service, dbService, notificationService } = createService();
      dbService.claimJobAlertSlots.mockResolvedValue(new Map());
      await service.handleJobNotifications(params);
      expect(
        notificationService.sendNotificationToMultipleProviders,
      ).not.toHaveBeenCalled();
      expect(dbService.finishJobAlert).not.toHaveBeenCalled();
    });

    it('sends only to the providers it claimed and marks a failed send as failed', async () => {
      const { service, dbService, notificationService } = createService();
      dbService.claimJobAlertSlots.mockResolvedValue(
        new Map([['provider-2', 'row-2']]),
      );
      notificationService.sendNotificationToMultipleProviders.mockResolvedValue(
        {
          success: 0,
          failed: 1,
          results: [
            { provider: { id: 'provider-2' }, success: false, error: 'boom' },
          ],
        },
      );
      await service.handleJobNotifications(params);
      expect(
        notificationService.sendNotificationToMultipleProviders,
      ).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'provider-2' })],
        expect.anything(),
      );
      expect(dbService.finishJobAlert).toHaveBeenCalledWith(
        'row-2',
        'failed',
        'boom',
        undefined,
      );
    });

    it('retries a failed alert-history insert so the sent row is stored', async () => {
      const { service, dbService, sreAlertTriageQueueService } =
        createService();
      dbService.claimJobAlertSlots.mockRejectedValue(new Error('no db'));
      const savedRow = { id: 'row-2' };
      dbService.saveAlertHistory
        .mockReset()
        .mockRejectedValueOnce(new Error('db blip'))
        .mockResolvedValue(savedRow);
      await service.handleJobNotifications(params);
      // The first row is retried once, then the second row is saved.
      expect(dbService.saveAlertHistory).toHaveBeenCalledTimes(3);
      // The retry reuses the row id, so a committed-but-unacknowledged insert is not duplicated.
      const ids = dbService.saveAlertHistory.mock.calls.map((call) => call[8]);
      expect(ids[0]).toEqual(expect.any(String));
      expect(ids[1]).toBe(ids[0]);
      expect(ids[2]).not.toBe(ids[0]);
      expect(
        sreAlertTriageQueueService.enqueueAlertHistoryRows,
      ).toHaveBeenCalledWith([savedRow, savedRow]);
    });

    it('counts a run created before the last alert but completed after it toward the reminder', async () => {
      const { service, dbService, notificationService } = createService();
      // Threshold 1: alert after failure 1, reminder 5 failures later (4 more runs plus the current one).
      (await dbService.getJobById()).alertConfig.failureThreshold = 1;
      dbService.getJobAlertStreakState.mockResolvedValue({
        sent: 1,
        lastSentAt: new Date(100_000),
      });
      dbService.getRecentRunsForJob.mockResolvedValue(
        Array.from({ length: 4 }, (_, i) => ({
          id: `old-${i}`,
          status: 'failed',
          createdAt: new Date(50_000 - i), // all created before the alert...
          completedAt: new Date(150_000 + i), // ...and all finished after it
        })),
      );
      await service.handleJobNotifications(params);
      expect(
        notificationService.sendNotificationToMultipleProviders,
      ).toHaveBeenCalledTimes(1);
    });

    it('does not count the current run toward a reminder when a newer run already alerted', async () => {
      const { service, dbService, notificationService } = createService();
      (await dbService.getJobById()).alertConfig.failureThreshold = 1;
      dbService.getJobAlertStreakState.mockResolvedValue({
        sent: 1,
        lastSentAt: new Date(200_000),
      });
      // Four failures after the alert plus this run would make five, but this run finished before the alert.
      dbService.getRecentRunsForJob.mockResolvedValue([
        {
          id: 'run-1',
          status: 'failed',
          createdAt: new Date(100_000),
          completedAt: new Date(150_000),
        },
        ...Array.from({ length: 4 }, (_, i) => ({
          id: `new-${i}`,
          status: 'failed',
          createdAt: new Date(210_000 + i),
          completedAt: new Date(220_000 + i),
        })),
      ]);
      await service.handleJobNotifications(params);
      expect(
        notificationService.sendNotificationToMultipleProviders,
      ).not.toHaveBeenCalled();
    });

    it('logs and swallows a failure loading the job', async () => {
      const { service, dbService } = createService();
      dbService.getJobById.mockRejectedValue(new Error('lookup failed'));
      await expect(
        service.handleJobNotifications(params),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to handle job notifications for job job-1: lookup failed',
        ),
      );
    });
  });

  describe('failure alert cap', () => {
    it('alerts at threshold, then every max(5, 2x threshold) failures after the last alert, max 3 sent', () => {
      // Walk a streak the way the service does: record each alert as sent.
      const alertingAt = (t: number, upTo = 40) => {
        let sent = 0;
        let sinceLast = 0;
        const at: number[] = [];
        for (let n = 1; n <= upTo; n++) {
          sinceLast++;
          if (isFailureAlertStreak(n, t, sent, sinceLast)) {
            at.push(n);
            sent++;
            sinceLast = 0;
          }
        }
        return at;
      };
      expect(alertingAt(1)).toEqual([1, 6, 11]);
      expect(alertingAt(2)).toEqual([2, 7, 12]);
      expect(alertingAt(3)).toEqual([3, 9, 15]);
      expect(maxFailureAlertStreak(1)).toBe(11);
      expect(maxFailureAlertStreak(3)).toBe(15);
    });

    // Feeds exactly the rows the service asks for, like the real query would. Run k (oldest = 1) was
    // created at k seconds; `sentAtFailure` is the failure after which the last alert went out.
    it.each([
      [3, 1, 1, false],
      [6, 1, 1, true],
      [11, 2, 6, true],
      [12, 3, 11, false],
      [40, 3, 11, false],
      // Failure alerts were off: no alert was ever sent, so a timeout deep in the streak still alerts.
      [40, 0, undefined, true],
      // Alerts failed to deliver (not counted as sent): the next failure past the threshold retries.
      [7, 0, undefined, true],
    ])(
      'job failure streak of %i with %i alerts sent (last after failure %s) sends=%s',
      async (streak, sent, sentAtFailure, sends) => {
        const { service, dbService, notificationService } = createService();
        dbService.getJobAlertStreakState.mockResolvedValue({
          sent,
          lastSentAt:
            sentAtFailure === undefined
              ? null
              : new Date((sentAtFailure + 0.5) * 1000),
        });
        dbService.getRecentRunsForJob.mockImplementation(
          (_id: string, limit: number) =>
            Promise.resolve(
              Array.from({ length: Math.min(limit, streak) }, (_, i) => ({
                id: i === 0 ? 'run-1' : `old-${i}`,
                status: 'failed',
                createdAt: new Date((streak - i) * 1000),
              })),
            ),
        );
        await service.handleJobNotifications({
          jobId: 'job-1',
          runId: 'run-1',
          finalStatus: 'failed',
          durationSeconds: 1,
        });
        expect(
          notificationService.sendNotificationToMultipleProviders,
        ).toHaveBeenCalledTimes(sends ? 1 : 0);
      },
    );

    it.each([
      [4, false],
      [6, true],
      [11, true],
      [16, false],
      [7, false],
    ])(
      'falls back to the positional rule when alert history is unreadable (streak %i sends=%s)',
      async (streak, sends) => {
        const { service, dbService, notificationService } = createService();
        dbService.getJobAlertStreakState.mockResolvedValue({
          sent: 0,
          lastSentAt: null,
          unknown: true,
        });
        dbService.getRecentRunsForJob.mockImplementation(
          (_id: string, limit: number) =>
            Promise.resolve(
              Array.from({ length: Math.min(limit, streak) }, (_, i) => ({
                id: i === 0 ? 'run-1' : `old-${i}`,
                status: 'failed',
                createdAt: new Date((streak - i) * 1000),
              })),
            ),
        );
        await service.handleJobNotifications({
          jobId: 'job-1',
          runId: 'run-1',
          finalStatus: 'failed',
          durationSeconds: 1,
        });
        expect(
          notificationService.sendNotificationToMultipleProviders,
        ).toHaveBeenCalledTimes(sends ? 1 : 0);
      },
    );

    it('still alerts on a timeout deep in a streak when failure alerts are off', async () => {
      const { service, dbService, notificationService } = createService();
      dbService.getJobById.mockResolvedValue({
        id: 'job-1',
        name: 'J',
        projectId: 'project-1',
        alertConfig: {
          enabled: true,
          notificationProviders: ['provider-1'],
          failureThreshold: 1,
          recoveryThreshold: 1,
          alertOnFailure: false,
          alertOnSuccess: false,
          alertOnTimeout: true,
        },
      });
      dbService.getRecentRunsForJob.mockResolvedValue(
        Array.from({ length: 11 }, (_, i) => ({
          id: `old-${i}`,
          status: 'failed',
          createdAt: new Date((20 - i) * 1000),
        })),
      );
      await service.handleJobNotifications({
        jobId: 'job-1',
        runId: 'run-1',
        finalStatus: 'timeout',
        durationSeconds: 1,
      });
      expect(
        notificationService.sendNotificationToMultipleProviders,
      ).toHaveBeenCalledTimes(1);
    });

    it('signals a recovery once, right after a failed run, even with alerts off', async () => {
      const { service, dbService, sreAlertTriageQueueService } =
        createService();
      dbService.getJobById.mockResolvedValue({
        id: 'job-1',
        name: 'J',
        alertConfig: { enabled: false, recoveryThreshold: 2 },
      });
      const passAfter = async (history: string[]) => {
        dbService.getRecentRunsForJob.mockResolvedValueOnce(
          history.map((status, i) => ({ id: `r${i}`, status })),
        );
        await service.handleJobNotifications({
          jobId: 'job-1',
          runId: 'run-new',
          finalStatus: 'passed',
          durationSeconds: 1,
        });
      };
      await passAfter(['failed']); // 1 pass, threshold 2: not yet
      await passAfter(['passed', 'failed']); // 2 passes after a failure: recovered
      await passAfter(['passed', 'passed']); // already recovered earlier
      expect(
        sreAlertTriageQueueService.enqueueSourceRecovery,
      ).toHaveBeenCalledTimes(1);
      expect(
        sreAlertTriageQueueService.enqueueSourceRecovery,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ sourceType: 'job', sourceId: 'job-1' }),
      );
    });

    it('does not alert for a run the user cancelled', async () => {
      const { service, notificationService } = createService();
      await service.handleJobNotifications({
        jobId: 'job-1',
        runId: 'run-1',
        finalStatus: 'error',
        cancelled: true,
        durationSeconds: 1,
      });
      expect(
        notificationService.sendNotificationToMultipleProviders,
      ).not.toHaveBeenCalled();
    });

    it('skips cancelled runs when counting the failure streak', async () => {
      const { service, dbService, notificationService } = createService();
      dbService.getJobById.mockResolvedValue({
        id: 'job-1',
        name: 'J',
        projectId: 'project-1',
        alertConfig: {
          enabled: true,
          notificationProviders: ['provider-1'],
          failureThreshold: 2,
          recoveryThreshold: 1,
          alertOnFailure: true,
          alertOnSuccess: false,
          alertOnTimeout: false,
        },
      });
      dbService.getRecentRunsForJob.mockResolvedValue([
        { id: 'r1', status: 'error', errorDetails: RUN_CANCELLATION_MARKER },
        { id: 'r0', status: 'failed', errorDetails: null },
      ]);
      await service.handleJobNotifications({
        jobId: 'job-1',
        runId: 'run-new',
        finalStatus: 'failed',
        durationSeconds: 1,
      });
      // current + r0 = 2 consecutive failures (threshold 2); the cancelled r1 must not count.
      expect(
        notificationService.sendNotificationToMultipleProviders,
      ).toHaveBeenCalledTimes(1);
    });

    it('requests enough history to see the last capped alert', async () => {
      const { service, dbService } = createService();
      await service.handleJobNotifications({
        jobId: 'job-1',
        runId: 'run-1',
        finalStatus: 'failed',
        durationSeconds: 1,
      });
      expect(dbService.getRecentRunsForJob).toHaveBeenCalledWith('job-1', 12);
    });
  });
});
