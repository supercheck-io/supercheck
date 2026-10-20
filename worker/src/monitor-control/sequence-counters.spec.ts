import { nextSequenceCounters } from './sequence-counters';

const last = (isUp: boolean, extra = {}) => ({
  isUp,
  consecutiveFailureCount: 0,
  consecutiveSuccessCount: 0,
  alertsSentForFailure: 0,
  alertsSentForRecovery: 0,
  ...extra,
});

describe('nextSequenceCounters', () => {
  it('starts a failure sequence on the first failure and flags a status change', () => {
    expect(nextSequenceCounters(undefined, false)).toMatchObject({
      consecutiveFailureCount: 1,
      consecutiveSuccessCount: 0,
      isStatusChange: true,
      recoverySequence: false,
    });
  });
  it('continues a failure sequence and keeps alerts already sent', () => {
    expect(
      nextSequenceCounters(
        last(false, { consecutiveFailureCount: 2, alertsSentForFailure: 1 }),
        false,
      ),
    ).toMatchObject({
      consecutiveFailureCount: 3,
      alertsSentForFailure: 1,
      isStatusChange: false,
    });
  });
  it('starts a recovery sequence after a failure', () => {
    expect(nextSequenceCounters(last(false), true)).toMatchObject({
      consecutiveSuccessCount: 1,
      consecutiveFailureCount: 0,
      alertsSentForFailure: 0,
      isStatusChange: true,
      recoverySequence: true,
    });
  });
  it('continues a recovery sequence', () => {
    expect(
      nextSequenceCounters(
        last(true, {
          consecutiveSuccessCount: 4,
          alertsSentForRecovery: 1,
          details: { recoverySequence: true },
        }),
        true,
      ),
    ).toMatchObject({
      consecutiveSuccessCount: 5,
      alertsSentForRecovery: 1,
      recoverySequence: true,
    });
  });
});
