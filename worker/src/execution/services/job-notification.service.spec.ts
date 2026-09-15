import { JobNotificationService } from './job-notification.service';

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
    };

    const service = new JobNotificationService(
      dbService as never,
      notificationService as never,
      sreAlertTriageQueueService as never,
    );

    return { service, dbService, sreAlertTriageQueueService };
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
});
