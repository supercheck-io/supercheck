import { registerIntakeStopper, stopIntake } from './shutdown-intake';

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
});
