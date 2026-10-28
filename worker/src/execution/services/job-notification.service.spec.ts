import { Logger } from '@nestjs/common';
import {
  isFailureAlertStreak,
  JobNotificationService,
  maxFailureAlertStreak,
} from './job-notification.service';

describe('JobNotificationService', () => {
  function createService() {
    const dbService = {
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
      saveAlertHistory: jest
        .fn()
        .mockResolvedValueOnce({ id: 'history-1', status: 'sent' })
        .mockResolvedValueOnce({ id: 'history-2', status: 'failed' }),
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

    expect(dbService.saveAlertHistory).toHaveBeenCalledTimes(2);
    expect(dbService.saveAlertHistory).toHaveBeenLastCalledWith(
      'job-1',
      'job_failed',
      'provider-2',
      'failed',
      expect.any(String),
      'failed',
      'Checkout smoke test',
      expect.objectContaining({
        version: 1,
        provider: { id: 'provider-2', type: 'webhook' },
      }),
    );
    expect(
      sreAlertTriageQueueService.enqueueAlertHistoryRows,
    ).toHaveBeenCalledWith([
      { id: 'history-1', status: 'sent' },
      { id: 'history-2', status: 'failed' },
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
          metadata: expect.objectContaining({ runId: 'run-1', duration: 90 }),
        }),
      );
      expect(dbService.saveAlertHistory).toHaveBeenCalledTimes(2);
      for (const call of dbService.saveAlertHistory.mock.calls) {
        expect(call.slice(0, 2)).toEqual(['job-1', 'job_timeout']);
      }
    });

    it.each([
      [0, false],
      [1, false],
      [2, true], // third consecutive failed/timed-out run reaches threshold 3
      [3, false],
      [8, true], // reminder at threshold + 6
      [14, true], // second reminder
      [20, false], // capped at 3 alerts
    ])(
      'applies the failure threshold, cadence and cap to timeouts (%i prior failed runs -> %s)',
      async (priorFailed, notifies) => {
        const { service, dbService, notificationService } = createService();
        (await dbService.getJobById()).alertConfig.failureThreshold = 3;
        dbService.getRecentRunsForJob.mockResolvedValue(
          Array.from({ length: priorFailed }, (_, i) => ({
            id: `old-${i}`,
            status: i % 2 ? 'error' : 'failed',
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
      dbService.saveAlertHistory
        .mockReset()
        .mockRejectedValue(new Error('db down'));
      await expect(
        service.handleJobNotifications(params),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to save alert history for job job-1: db down',
        ),
      );
      expect(
        sreAlertTriageQueueService.enqueueAlertHistoryRows,
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
    it('alerts at threshold then every max(5, 2x threshold), max 3 per streak', () => {
      const alertingAt = (t: number, upTo = 40) =>
        Array.from({ length: upTo }, (_, i) => i + 1).filter((n) =>
          isFailureAlertStreak(n, t),
        );
      expect(alertingAt(1)).toEqual([1, 6, 11]);
      expect(alertingAt(2)).toEqual([2, 7, 12]);
      expect(alertingAt(3)).toEqual([3, 9, 15]);
      expect(maxFailureAlertStreak(1)).toBe(11);
      expect(maxFailureAlertStreak(3)).toBe(15);
    });

    // Feeds exactly the rows the service asks for, like the real query would.
    it.each([
      [2, false],
      [6, true],
      [11, true],
      [12, false],
      [16, false],
      [40, false],
    ])('job failure streak of %i sends=%s', async (streak, sends) => {
      const { service, dbService, notificationService } = createService();
      dbService.getRecentRunsForJob.mockImplementation(
        (_id: string, limit: number) =>
          Promise.resolve(
            Array.from({ length: Math.min(limit, streak) }, (_, i) => ({
              id: i === 0 ? 'run-1' : `old-${i}`,
              status: 'failed',
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
