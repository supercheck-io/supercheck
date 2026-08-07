import { UsageTrackerService } from './usage-tracker.service';

describe('UsageTrackerService execution blocking', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSelfHosted = process.env.SELF_HOSTED;
  const originalPolarAccessToken = process.env.POLAR_ACCESS_TOKEN;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalSelfHosted === undefined) delete process.env.SELF_HOSTED;
    else process.env.SELF_HOSTED = originalSelfHosted;
    if (originalPolarAccessToken === undefined) {
      delete process.env.POLAR_ACCESS_TOKEN;
    } else {
      process.env.POLAR_ACCESS_TOKEN = originalPolarAccessToken;
    }
  });

  it('fails closed when cloud production billing is not configured', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SELF_HOSTED;
    delete process.env.POLAR_ACCESS_TOKEN;
    const db = { execute: jest.fn() };
    const service = new UsageTrackerService(db as never);

    await expect(service.shouldBlockExecution('org-1')).resolves.toEqual({
      blocked: true,
      reason: 'Cloud billing enforcement is not configured',
    });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('keeps explicitly self-hosted deployments independent of Polar', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SELF_HOSTED = 'true';
    delete process.env.POLAR_ACCESS_TOKEN;
    const service = new UsageTrackerService({ execute: jest.fn() } as never);

    await expect(service.shouldBlockExecution('org-1')).resolves.toEqual({
      blocked: false,
    });
  });

  it('fails closed when a configured cloud billing check errors', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SELF_HOSTED;
    process.env.POLAR_ACCESS_TOKEN = 'configured-for-test';
    const service = new UsageTrackerService({
      execute: jest.fn().mockRejectedValue(new Error('database unavailable')),
    } as never);

    await expect(service.shouldBlockExecution('org-1')).resolves.toEqual({
      blocked: true,
      reason: 'Unable to verify the organization spending limit',
    });
  });
});
