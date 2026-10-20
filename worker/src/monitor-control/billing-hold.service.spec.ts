import {
  BillingHoldService,
  BillingVerificationError,
  controlPlaneConfigProblem,
} from './billing-hold.service';
import { UsageTrackerService } from '../execution/services/usage-tracker.service';

describe('BillingHoldService', () => {
  const monitor = { id: 'm-1', type: 'http_request' };
  const service = new BillingHoldService({} as never);
  afterEach(() => jest.restoreAllMocks());

  it('passes a genuine hold through so the cycle is aborted, not retried', async () => {
    jest
      .spyOn(UsageTrackerService.prototype, 'shouldBlockExecution')
      .mockResolvedValue({
        blocked: true,
        reason: 'An active subscription is required',
      });
    await expect(service.isHeld('org', monitor)).resolves.toEqual({
      blocked: true,
      reason: 'An active subscription is required',
    });
  });

  it.each([
    'Unable to verify monitor quota',
    'Unable to verify the organization spending limit',
    'Cloud billing enforcement is not configured',
  ])(
    'throws for the unverifiable state %j so the cycle stays open and is retried',
    async (reason) => {
      jest
        .spyOn(UsageTrackerService.prototype, 'shouldBlockExecution')
        .mockResolvedValue({ blocked: true, reason });
      await expect(service.isHeld('org', monitor)).rejects.toBeInstanceOf(
        BillingVerificationError,
      );
    },
  );

  it('allows an unblocked organization', async () => {
    jest
      .spyOn(UsageTrackerService.prototype, 'shouldBlockExecution')
      .mockResolvedValue({ blocked: false });
    await expect(service.isHeld('org', monitor)).resolves.toEqual({
      blocked: false,
    });
  });

  it('checks the spending limit only for synthetic monitors', async () => {
    const spy = jest
      .spyOn(UsageTrackerService.prototype, 'shouldBlockExecution')
      .mockResolvedValue({ blocked: false });
    await service.isHeld('org', { id: 'm-2', type: 'synthetic_test' });
    expect(spy).toHaveBeenCalledWith('org', {
      checkSpendingLimit: true,
      monitorId: 'm-2',
    });
  });
});

describe('controlPlaneConfigProblem', () => {
  it('is fine for self-hosted installs with no billing credentials', () => {
    expect(controlPlaneConfigProblem({ SELF_HOSTED: 'true' })).toBeNull();
    expect(controlPlaneConfigProblem({ SELF_HOSTED: '1' })).toBeNull();
  });
  it('requires the billing token in cloud mode', () => {
    expect(controlPlaneConfigProblem({})).toMatch(/POLAR_ACCESS_TOKEN/);
    expect(controlPlaneConfigProblem({ POLAR_ACCESS_TOKEN: 'x' })).toBeNull();
  });
});
