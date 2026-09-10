/** @jest-environment node */
jest.mock('./middleware/plan-enforcement', () => ({ checkCapacityLimits: jest.fn() }));
jest.mock('./queue', () => ({
  getRedisConnection: jest.fn().mockResolvedValue({}),
  queueLogger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { CapacityManager, setupCapacityManagement, QueueParameters, QueueEventsParameters } from './capacity-manager';

describe('capacity failure events', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['failed', 0, true], // stalled recovery exhausted before any completed attempt
    ['failed', 1, true], // unrecoverable error before configured attempts
    ['delayed', 1, false],
    ['waiting', 1, false],
    ['active', 1, false],
  ])('state %s with %s attempts releases capacity: %s', async (state, attemptsMade, releases) => {
    const release = jest.spyOn(CapacityManager.prototype, 'releaseRunningSlot').mockResolvedValue();
    jest.spyOn(CapacityManager.prototype, 'getJobOrganization').mockResolvedValue('org-1');
    jest.spyOn(CapacityManager.prototype, 'startQueueProcessor').mockImplementation(() => {});
    const callbacks = new Map<string, (event: { jobId: string }) => Promise<void>>();
    const queue = { getJob: jest.fn().mockResolvedValue({
      opts: { attempts: 3 }, attemptsMade, getState: jest.fn().mockResolvedValue(state),
    }) };
    const events = { on: jest.fn((name, callback) => callbacks.set(name, callback)) };
    await setupCapacityManagement(
      { playwrightQueues: { global: queue }, k6Queues: {} } as unknown as QueueParameters,
      { playwrightEvents: { global: events }, k6Events: {} } as unknown as QueueEventsParameters,
    );
    await callbacks.get('failed')!({ jobId: 'run-1' });
    if (releases) expect(release).toHaveBeenCalledWith('org-1', 'run-1');
    else expect(release).not.toHaveBeenCalled();
  });
});
