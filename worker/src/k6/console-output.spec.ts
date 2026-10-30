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

  it('does not leave lone surrogates at the cuts', () => {
    const out = truncateConsoleOutput(
      `${'a'.repeat(1999)}😀${'b'.repeat(7999)}😀tail`,
    );
    expect(
      /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(
        out,
      ),
    ).toBe(false);
  });
});
