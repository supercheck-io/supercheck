import { runPool } from './run-pool';

describe('runPool', () => {
  it('never exceeds the concurrency limit and visits every item once', async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPool([...Array(20).keys()], 4, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      seen.push(item);
      active -= 1;
    });
    expect(peak).toBe(4);
    expect(seen.sort((a, b) => a - b)).toEqual([...Array(20).keys()]);
  });

  it('lets a slow item run while the rest drain', async () => {
    const order: string[] = [];
    let releaseSlow!: () => void;
    let finishFast!: () => void;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const fast = new Promise<void>((resolve) => {
      finishFast = resolve;
    });
    const pending = runPool(['slow', 'a', 'b', 'c'], 2, async (item) => {
      if (item === 'slow') await slow;
      order.push(item);
      if (item === 'c') finishFast();
    });
    try {
      await fast;
      expect(order).toEqual(['a', 'b', 'c']);
    } finally {
      releaseSlow();
      await pending;
    }
    expect(order).toEqual(['a', 'b', 'c', 'slow']);
  });

  it('handles an empty list', async () => {
    await expect(
      runPool([], 8, async () => undefined),
    ).resolves.toBeUndefined();
  });
});
