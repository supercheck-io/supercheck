import { decideMonitorCycle } from './cycle-policy';
const snapshot = {
  expectedLocations: ['eu', 'us', 'ap'],
  strategy: 'all' as const,
  threshold: 50,
};
describe('monitor cycle closure', () => {
  it('waits for a silent region until the durable deadline', () => {
    expect(
      decideMonitorCycle(snapshot, { eu: true, us: true }, false),
    ).toBeNull();
    expect(
      decideMonitorCycle(snapshot, { eu: true, us: true }, true),
    ).toMatchObject({ status: 'down', missing: ['ap'], closedBy: 'deadline' });
  });
  it.each(['all', 'any', 'majority'] as const)(
    'closes all-offline %s as down at the deadline',
    (strategy) => {
      expect(
        decideMonitorCycle({ ...snapshot, strategy }, {}, false),
      ).toBeNull();
      expect(
        decideMonitorCycle({ ...snapshot, strategy }, {}, true),
      ).toMatchObject({
        status: 'down',
        observed: [],
        missing: ['eu', 'us', 'ap'],
      });
    },
  );
  it('closes a decisive all failure on arrival', () => {
    expect(decideMonitorCycle(snapshot, { eu: false }, false)).toMatchObject({
      status: 'down',
      closedBy: 'arrival',
    });
  });
  it('closes any success on arrival and waits for unknown possibilities after failures', () => {
    expect(
      decideMonitorCycle({ ...snapshot, strategy: 'any' }, { eu: true }, false),
    ).toMatchObject({ status: 'up' });
    expect(
      decideMonitorCycle(
        { ...snapshot, strategy: 'any' },
        { eu: false, us: false },
        false,
      ),
    ).toBeNull();
  });
  it('preserves the configured majority percentage and closes decisive success or failure', () => {
    const majority = {
      ...snapshot,
      strategy: 'majority' as const,
      threshold: 66,
    };
    expect(
      decideMonitorCycle(majority, { eu: true, us: true }, false),
    ).toMatchObject({ status: 'up' });
    expect(
      decideMonitorCycle(majority, { eu: false, us: false }, false),
    ).toMatchObject({ status: 'down' });
    expect(decideMonitorCycle(majority, { eu: true }, false)).toBeNull();
  });
  it('ignores results outside the immutable expected location snapshot', () => {
    expect(
      decideMonitorCycle(
        { ...snapshot, strategy: 'any' },
        { other: true },
        true,
      ),
    ).toMatchObject({ status: 'down', observed: [] });
  });
});
