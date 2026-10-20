import { LocationService } from '../common/location/location.service';
import { decideMonitorCycle } from './cycle-policy';

const locations = ['eu', 'us', 'ap', 'sa'];
const service = new LocationService();

/** Every up/down/missing combination for the given locations. */
function combos(expected: string[]): Record<string, boolean>[] {
  const out: Record<string, boolean>[] = [{}];
  for (const location of expected) {
    const next: Record<string, boolean>[] = [];
    for (const partial of out) {
      next.push(partial, { ...partial, [location]: true }, { ...partial, [location]: false });
    }
    out.splice(0, out.length, ...next);
  }
  return out;
}

describe('cycle policy parity with LocationService.calculateAggregatedStatus', () => {
  for (const strategy of ['all', 'any', 'majority'] as const) {
    for (const threshold of [0, 1, 34, 50, 51, 67, 100]) {
      for (const size of [1, 2, 3, 4]) {
        it(`${strategy}/${threshold}% over ${size} region(s) matches at the deadline`, () => {
          const expected = locations.slice(0, size);
          for (const results of combos(expected)) {
            const decision = decideMonitorCycle(
              { expectedLocations: expected, strategy, threshold },
              results,
              true,
            );
            const legacy = service.calculateAggregatedStatus(results, {
              enabled: true,
              locations: expected,
              threshold,
              strategy,
            });
            const anyObserved = Object.keys(results).length > 0;
            // Deliberate divergence: a cycle where no region reported is always down,
            // even for a 0% majority threshold. 'partial' counts as down.
            const want = !anyObserved ? 'down' : legacy === 'up' ? 'up' : 'down';
            expect({ results, status: decision?.status }).toEqual({
              results,
              status: want,
            });
          }
        });
      }
    }
  }

  it('treats an empty expected set as down, like the legacy aggregator', () => {
    expect(
      decideMonitorCycle(
        { expectedLocations: [], strategy: 'majority', threshold: 50 },
        {},
        false,
      ),
    ).toMatchObject({ status: 'down' });
  });

  it('never closes early to the opposite of what the deadline would decide', () => {
    for (const strategy of ['all', 'any', 'majority'] as const) {
      for (const threshold of [0, 50, 100]) {
        const snapshot = { expectedLocations: locations.slice(0, 3), strategy, threshold };
        for (const results of combos(snapshot.expectedLocations)) {
          const early = decideMonitorCycle(snapshot, results, false);
          if (!early) continue;
          expect(early.status).toBe(decideMonitorCycle(snapshot, results, true)?.status);
        }
      }
    }
  });
});
