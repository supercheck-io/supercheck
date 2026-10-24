import {
  ExecutionAdmissionService,
  type ExecutionReservation,
  hasActiveExecutionPlan,
} from './execution-admission.service';
import { attachBillableMs } from '../../common/billable-ms';

const reservation: ExecutionReservation = {
  runId: 'run',
  organizationId: 'org',
  ownerToken: 'owner',
  reservedMs: 10000,
  limited: true,
};
it('holds allowance and concurrency until the final callback drains', async () => {
  const service = new ExecutionAdmissionService({} as never);
  jest.spyOn(service, 'reserve').mockResolvedValue(reservation);
  const finish = jest.spyOn(service, 'finish').mockResolvedValue(undefined);
  let drain!: (result: { billableMs: number }) => void;
  const callback = new Promise<{ billableMs: number }>((resolve) => {
    drain = resolve;
  });
  const execution = service.run(
    'org',
    'run',
    'playwright',
    10000,
    async () => callback,
  );
  await Promise.resolve();
  expect(finish).not.toHaveBeenCalled();
  drain({ billableMs: 4000 });
  await execution;
  expect(finish).toHaveBeenCalledWith(reservation, 4000);
});
it('retains observed execution usage on an upload failure', async () => {
  const service = new ExecutionAdmissionService({} as never);
  jest.spyOn(service, 'reserve').mockResolvedValue(reservation);
  const finish = jest.spyOn(service, 'finish').mockResolvedValue(undefined);
  await expect(
    service.run('org', 'run', 'playwright', 10000, async () => {
      throw attachBillableMs(new Error('upload failed'), 3000);
    }),
  ).rejects.toThrow('upload failed');
  expect(finish).toHaveBeenCalledWith(reservation, 3000);
});
it.each(['active', 'past_due', 'canceled'])(
  'preserves authorized standard %s access',
  (status) => {
    expect(
      hasActiveExecutionPlan({
        polarCustomerId: 'customer',
        subscriptionPlan: 'plus',
        subscriptionStatus: status,
        subscriptionEndsAt: new Date(Date.now() + 60000),
      }),
    ).toBe(true);
  },
);
it('does not infer access from an expired end date or a plan name alone', () => {
  expect(
    hasActiveExecutionPlan({
      polarCustomerId: 'customer',
      subscriptionPlan: 'plus',
      subscriptionStatus: 'canceled',
      subscriptionEndsAt: new Date(0),
    }),
  ).toBe(false);
  expect(
    hasActiveExecutionPlan({
      subscriptionPlan: 'plus',
      subscriptionStatus: 'active',
    }),
  ).toBe(false);
});
