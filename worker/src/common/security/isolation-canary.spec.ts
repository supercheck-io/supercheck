import { isIsolationPoolBlocked } from './isolation-canary';

describe('isolation canary admission', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const health = (status: string, age: number) =>
    JSON.stringify({ status, completedAt: new Date(now - age).toISOString() });
  it('blocks a fresh explicit pool failure until success or expiry', () => {
    expect(isIsolationPoolBlocked(health('failed', 1), now)).toBe(true);
    expect(isIsolationPoolBlocked(health('passed', 1), now)).toBe(false);
    expect(
      isIsolationPoolBlocked(health('failed', 20 * 60 * 1000 + 1), now),
    ).toBe(false);
  });
  it('allows missing, malformed, unknown and future-dated data', () => {
    for (const raw of [
      undefined,
      '',
      'invalid',
      'null',
      '{}',
      health('unknown', 1),
      health('failed', -1),
    ]) {
      expect(isIsolationPoolBlocked(raw, now)).toBe(false);
    }
  });
});
