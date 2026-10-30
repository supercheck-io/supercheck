import { truncateConsoleOutput } from './console-output';

describe('truncateConsoleOutput', () => {
  it('keeps the tail so threshold lines survive', () => {
    const out = truncateConsoleOutput(
      `HEAD${'x'.repeat(50_000)}THRESHOLD FAILED`,
    );
    expect(out.length).toBeLessThan(10_100);
    expect(out.startsWith('HEAD')).toBe(true);
    expect(out.endsWith('THRESHOLD FAILED')).toBe(true);
    expect(truncateConsoleOutput('short')).toBe('short');
  });
});
