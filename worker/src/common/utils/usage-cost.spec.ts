import { ceilUsageCostCents } from './usage-cost';

describe('currency rounding for K6 VU-minutes', () => {
  it.each([
    [28, 0.25, 7],
    [400, 0.0175, 7],
    [401, 0.0175, 8],
    [1, 0.0001, 1],
    [0, 0.25, 0],
  ])('rounds %s units at %s cents to %s cents', (units, rate, expected) => {
    expect(ceilUsageCostCents(units, rate)).toBe(expected);
  });
  it('matches exact scaled-integer custom-rate arithmetic across period counts', () => {
    for (let units = 0; units < 200_000; units++) {
      expect(ceilUsageCostCents(units, 0.0175)).toBe(
        Math.ceil((units * 175) / 10_000),
      );
    }
  });
});
