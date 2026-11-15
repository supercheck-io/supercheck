import { nextOutageKey, nextSequenceCounters } from './sequence-counters';

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

describe('nextOutageKey', () => {
  const KEY = '0194a1c0-0000-7000-8000-000000000009';
  it('starts a new outage on the first failure and after a recovery', () => {
    const fresh = nextOutageKey(undefined, false);
    expect(fresh).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      nextOutageKey(last(true, { details: { outageKey: KEY } }), false),
    ).not.toBe(KEY);
  });
  it('continues the key of the failing row, and mints one for a legacy row without it', () => {
    expect(
      nextOutageKey(last(false, { details: { outageKey: KEY } }), false),
    ).toBe(KEY);
    expect(nextOutageKey(last(false, { details: {} }), false)).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(nextOutageKey(last(false), false)).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('gives an up row the key of the outage it recovers from, and none once recovery is over', () => {
    expect(
      nextOutageKey(last(false, { details: { outageKey: KEY } }), true),
    ).toBe(KEY);
    expect(
      nextOutageKey(
        last(true, { details: { outageKey: KEY, recoverySequence: true } }),
        true,
      ),
    ).toBe(KEY);
    expect(
      nextOutageKey(last(true, { details: { outageKey: KEY } }), true),
    ).toBeUndefined();
    expect(nextOutageKey(undefined, true)).toBeUndefined();
    expect(nextOutageKey(last(false), true)).toBeUndefined();
  });
});

describe('maintenance windows freeze the failure sequence', () => {
  it('a failure inside a window after an up check starts nothing: count 0, no outage key', () => {
    expect(nextSequenceCounters(last(true), false, true)).toMatchObject({
      consecutiveFailureCount: 0,
      alertsSentForFailure: 0,
      consecutiveSuccessCount: 0,
      isStatusChange: true,
    });
    expect(nextOutageKey(last(true), false, true)).toBeUndefined();
    expect(nextOutageKey(undefined, false, true)).toBeUndefined();
  });

  it('a sequence open before the window keeps its counts and key', () => {
    const before = last(false, {
      consecutiveFailureCount: 4,
      alertsSentForFailure: 1,
      details: { outageKey: 'k-1' },
    });
    expect(nextSequenceCounters(before, false, true)).toMatchObject({
      consecutiveFailureCount: 4,
      alertsSentForFailure: 1,
      isStatusChange: false,
    });
    expect(nextOutageKey(before, false, true)).toBe('k-1');
  });

  it('after a window the first failure opens a fresh sequence with a new key', () => {
    const frozen = last(false, { consecutiveFailureCount: 0 });
    expect(nextSequenceCounters(frozen, false)).toMatchObject({
      consecutiveFailureCount: 1,
    });
    expect(nextOutageKey(frozen, false)).toEqual(expect.any(String));
  });

  it('never freezes a success', () => {
    expect(
      nextSequenceCounters(
        last(false, { consecutiveFailureCount: 3 }),
        true,
        true,
      ),
    ).toMatchObject({ consecutiveSuccessCount: 1, consecutiveFailureCount: 0 });
  });
});
