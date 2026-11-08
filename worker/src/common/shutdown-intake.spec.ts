import {
  inFlightCount,
  isDraining,
  registerIntakeStopper,
  stopIntake,
  trackInFlight,
} from './shutdown-intake';

describe('shutdown intake', () => {
  it('stops every registered consumer even when one fails to pause', async () => {
    const stopped: string[] = [];
    const unregister = [
      registerIntakeStopper(async () => {
        throw new Error('pause failed');
      }),
      registerIntakeStopper(() => void stopped.push('a')),
      registerIntakeStopper(async () => void stopped.push('b')),
    ];

    await expect(stopIntake()).resolves.toBeUndefined();

    expect(stopped.sort()).toEqual(['a', 'b']);
    unregister.forEach((fn) => fn());
    stopped.length = 0;
    await stopIntake();
    expect(stopped).toEqual([]);
  });

  it('counts work from pickup until it settles, including when it fails', async () => {
    let release!: () => void;
    const first = trackInFlight(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const failing = trackInFlight(async () => {
      throw new Error('boom');
    }).catch(() => undefined);

    await failing;
    expect(inFlightCount()).toBe(1);
    release();
    await first;
    expect(inFlightCount()).toBe(0);
  });

  it('reports draining once intake was stopped', async () => {
    await stopIntake();
    expect(isDraining()).toBe(true);
  });
});
