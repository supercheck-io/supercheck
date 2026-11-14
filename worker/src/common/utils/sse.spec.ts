import { Readable } from 'node:stream';
import { readSse } from './sse';

const stream = (...chunks: string[]) =>
  Readable.from(chunks.map((c) => Buffer.from(c)));

describe('readSse', () => {
  it('yields data lines across chunk boundaries and stops at [DONE]', async () => {
    const seen: string[] = [];
    const result = await readSse(
      stream(
        'data: {"a"',
        ':1}\r\n\r\n: ping\n',
        'event: x\ndata:two\n',
        'data: [DONE]\n',
        'data: late\n',
      ),
      (d) => seen.push(d),
      1024,
    );
    expect(seen).toEqual(['{"a":1}', 'two']);
    expect(result).toEqual({ done: true, truncated: false });
  });

  it('reports a stream that ends without [DONE]', async () => {
    const result = await readSse(stream('data: x\n'), () => undefined, 1024);
    expect(result).toEqual({ done: false, truncated: false });
  });

  it('accepts a final [DONE] without a trailing newline', async () => {
    const seen: string[] = [];
    const result = await readSse(
      stream('data: x\n', 'data: [DONE]'),
      (d) => seen.push(d),
      1024,
    );
    expect(seen).toEqual(['x']);
    expect(result).toEqual({ done: true, truncated: false });
  });

  it('stops at the byte cap', async () => {
    const result = await readSse(
      stream('data: aaaa\n', 'data: bbbb\n'),
      () => undefined,
      5,
    );
    expect(result).toEqual({ done: false, truncated: true });
  });

  it('propagates stream errors', async () => {
    const s = new Readable({
      read() {
        this.destroy(new Error('boom'));
      },
    });
    await expect(readSse(s, () => undefined, 10)).rejects.toThrow('boom');
  });
});
